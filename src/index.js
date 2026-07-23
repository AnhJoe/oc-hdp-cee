import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';
import { kvs } from '@forge/kvs';

const resolver = new Resolver();

// Flattens any ADF node's nested text content into a plain string. Used
// anywhere we need a table cell or heading's text.
function extractText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (!node.content) return '';
  return node.content.map(extractText).join('');
}

// Reads a table's header row into column label strings, so tables are
// identified by header text rather than by localId (localIds regenerate if
// the page is ever recreated).
function getHeaderLabels(table) {
  const headerRow = table.content?.[0];
  return (headerRow?.content || []).map((cell) => extractText(cell).trim());
}

// Reads a table cell's value. A cell is one of three shapes on this page:
// a taskList (checkbox-style single/multi-select), a paragraph with an
// inline `date` node (Exercise Date), or a plain paragraph of free text.
function readCell(cell) {
  const nodes = cell?.content || [];

  const taskList = nodes.find((n) => n.type === 'taskList');
  if (taskList) {
    const choices = (taskList.content || []).map((item) => ({
      label: extractText(item).trim(),
      checked: item.attrs?.state === 'DONE'
    }));
    return { kind: 'choices', choices };
  }

  const paragraph = nodes.find((n) => n.type === 'paragraph');
  const dateNode = paragraph?.content?.find((n) => n.type === 'date');
  if (dateNode) {
    const ms = Number(dateNode.attrs?.timestamp);
    return { kind: 'date', date: Number.isFinite(ms) ? new Date(ms).toISOString() : null };
  }

  return { kind: 'text', text: extractText(paragraph).trim() };
}

// Walks the Exercise Designer's "Field | Instructor Entry | Guidance" table
// into a { label: value } object. Reads whatever rows exist, so instructors
// can add new metadata fields later without any code change here.
function extractMetadata(table) {
  const metadata = {};
  if (!table) return metadata;

  const rows = (table.content || []).slice(1);
  for (const row of rows) {
    const cells = row.content || [];
    const label = extractText(cells[0]).trim();
    if (!label) continue;
    metadata[label] = readCell(cells[1]);
  }
  return metadata;
}

// Walks the "Capability | Select | Notes" table into a list of
// { name, selected } entries, one per CDC PHEP capability row.
function extractCapabilities(table) {
  const capabilities = [];
  if (!table) return capabilities;

  const rows = (table.content || []).slice(1);
  for (const row of rows) {
    const cells = row.content || [];
    const name = extractText(cells[0]).trim();
    if (!name) continue;
    const selectCell = readCell(cells[1]);
    const selected = selectCell.kind === 'choices' && selectCell.choices.some((c) => c.checked);
    capabilities.push({ name, selected });
  }
  return capabilities;
}

// Fetches a Confluence page's ADF body and pulls out the Exercise
// Designer's metadata table and capability selections.
async function loadExercisePage(pageId) {
  const response = await api.asApp().requestConfluence(
    route`/wiki/api/v2/pages/${pageId}?body-format=atlas_doc_format`
  );
  const page = await response.json();

  // The ADF body comes back as a JSON string, not a parsed object.
  const adfBody = page.body?.atlas_doc_format?.value
    ? JSON.parse(page.body.atlas_doc_format.value)
    : null;

  const tables = (adfBody?.content || []).filter((n) => n.type === 'table');
  const metadataTable = tables.find((t) => getHeaderLabels(t)[0] === 'Field');
  const capabilityTable = tables.find((t) => getHeaderLabels(t)[0] === 'Capability');

  return {
    page,
    metadata: extractMetadata(metadataTable),
    capabilities: extractCapabilities(capabilityTable)
  };
}

resolver.define('getPageInfo', async (req) => {
  const pageId = req.context.extension.content.id;
  const { page, metadata, capabilities } = await loadExercisePage(pageId);

  return {
    id: page.id,
    title: page.title,
    status: page.status,
    metadata,
    capabilities
  };
});

// ---------------------------------------------------------------------------
// Question bank: reads the "AAR Question Bank" page and merges the selected
// capabilities' questions (plus the always-included Participant Information
// intro section) into a Forms API design JSON.
// ---------------------------------------------------------------------------

const QUESTION_BANK_PAGE_TITLE = 'AAR Question Bank';
const INTRO_SECTION_TITLE = 'Participant Information';

// Fixed 1-5 rating scale for every "Rating (1-5)" question, matching the
// "[DO NOT DELETE] CEE Template" baseline so admins don't retype it.
const RATING_CHOICES = [
  { id: '1', label: '1. Ineffective', other: false },
  { id: '2', label: '2. Needs Improvement', other: false },
  { id: '3', label: '3. Adequate', other: false },
  { id: '4', label: '4. Effective', other: false },
  { id: '5', label: '5. Exceptional', other: false }
];

// Maps the admin-facing "Answer Type" label to the Forms API's internal
// question type code. Every entry works in any section - there's no
// per-section restriction on which answer types are allowed.
const ANSWER_TYPE_MAP = {
  'Rating (1-5)': 'cs',
  'Long Text': 'tl',
  'Single Choice': 'cs',
  'Multi Choice': 'cm',
  Dropdown: 'cd',
  Date: 'da'
};

// Answer types whose Choices column holds semicolon-separated options
// (Rating uses the fixed scale above; Long Text and Date have none).
const CHOICE_DRIVEN_ANSWER_TYPES = ['Single Choice', 'Multi Choice', 'Dropdown'];

// Looks up a page by exact title within a space, used to find the Question
// Bank regardless of which space it lives in.
async function findPageIdByTitle(spaceId, title) {
  // Pass `title` straight through - `route` already URL-encodes interpolated
  // values, so running it through encodeURIComponent first double-encodes it
  // (a space becomes %2520 instead of %20) and the title never matches.
  const response = await api.asApp().requestConfluence(
    route`/wiki/api/v2/pages?space-id=${spaceId}&title=${title}&status=current`
  );
  const data = await response.json();
  return data.results || [];
}

// Splits the Question Bank page into { title, table } sections by pairing
// each heading with the table immediately after it.
function splitQuestionBankSections(doc) {
  const sections = [];
  let current = null;

  for (const node of doc?.content || []) {
    if (node.type === 'heading') {
      current = { title: extractText(node).trim(), table: null };
      sections.push(current);
    } else if (node.type === 'table' && current && !current.table) {
      current.table = node;
    }
  }

  return sections;
}

// Walks one section's "Question Text | Answer Type | Required | Choices"
// table into plain question rows, skipping incomplete ones.
function extractQuestionRows(table) {
  const rows = (table?.content || []).slice(1);
  const questions = [];

  for (const row of rows) {
    const cells = row.content || [];
    const text = extractText(cells[0]).trim();
    const answerType = extractText(cells[1]).trim();
    if (!text || !answerType) continue;

    const requiredCell = readCell(cells[2]);
    const required = requiredCell.kind === 'choices' && requiredCell.choices.some((c) => c.checked);
    const choicesText = extractText(cells[3]).trim();

    questions.push({ text, answerType, required, choicesText });
  }

  return questions;
}

// Converts one question-bank row into a Forms API question definition, or
// null if the Answer Type isn't recognized (skipped safely).
function buildQuestionDefinition(row) {
  const type = ANSWER_TYPE_MAP[row.answerType];
  if (!type) return null;

  let choices = [];
  if (row.answerType === 'Rating (1-5)') {
    choices = RATING_CHOICES;
  } else if (CHOICE_DRIVEN_ANSWER_TYPES.includes(row.answerType)) {
    choices = row.choicesText
      .split(';')
      .map((label) => label.trim())
      .filter(Boolean)
      .map((label, index) => ({ id: String(index + 1), label, other: false }));
  }

  return {
    type,
    label: row.text,
    description: '',
    questionKey: '',
    choices,
    validation: { rq: row.required }
  };
}

function paragraphNode(text) {
  return { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] };
}

// ADF heading node for section titles - must be a real heading (not a
// paragraph) or it won't render as one in the created form.
function headingNode(text, level = 2) {
  return {
    type: 'heading',
    attrs: { level },
    content: text ? [{ type: 'text', text }] : []
  };
}

function extensionNode(id) {
  return {
    type: 'extension',
    attrs: {
      extensionKey: 'question',
      extensionType: 'com.thinktilt.proforma',
      parameters: { id: Number(id) },
      layout: 'default'
    }
  };
}

// Formats one metadata field's tagged value (text/date/choices) into a
// plain display string, for the read-only exercise info block below.
function formatMetadataValue(value) {
  if (!value) return '(blank)';
  if (value.kind === 'text') return value.text || '(blank)';
  if (value.kind === 'date') {
    return value.date ? new Date(value.date).toLocaleDateString() : '(no date)';
  }
  if (value.kind === 'choices') {
    const checked = value.choices
      .filter((choice) => choice.checked)
      .map((choice) => choice.label)
      .filter(Boolean);
    return checked.length ? checked.join(', ') : '(none selected)';
  }
  return '';
}

// A bold label followed by plain value text on one line, e.g.
// "Instructor Name: Jane Doe".
function labeledParagraphNode(label, valueText) {
  return {
    type: 'paragraph',
    content: [
      { type: 'text', text: `${label}: `, marks: [{ type: 'strong' }] },
      { type: 'text', text: valueText || '(blank)' }
    ]
  };
}

// A simple ADF bullet list, one item per string.
function bulletListNode(items) {
  return {
    type: 'bulletList',
    content: items.map((item) => ({
      type: 'listItem',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: item }] }]
    }))
  };
}

// A standalone bold-text paragraph, used as a label above a list rather
// than inline with a value (see labeledParagraphNode above).
function boldParagraphNode(text) {
  return { type: 'paragraph', content: [{ type: 'text', text, marks: [{ type: 'strong' }] }] };
}

// Builds the read-only "Exercise Information" block placed at the top of
// every generated form: the exercise's metadata and selected capabilities,
// so participants have that context before answering questions. Reads
// whatever fields exist in `metadata` rather than hardcoding field names,
// so new metadata rows show up automatically. Only plain paragraph/heading/
// bulletList nodes are used here (no extension/question nodes), so none of
// it is fillable by participants.
function buildExerciseInfoNodes(metadata, selectedCapabilityNames) {
  const nodes = [headingNode('Exercise Information', 1)];

  const metadataEntries = Object.entries(metadata || {});
  if (metadataEntries.length) {
    for (const [label, value] of metadataEntries) {
      nodes.push(labeledParagraphNode(label, formatMetadataValue(value)));
    }
  } else {
    nodes.push(paragraphNode('(no exercise metadata found)'));
  }

  nodes.push(paragraphNode());
  nodes.push(boldParagraphNode('Selected Capabilities:'));
  nodes.push(
    selectedCapabilityNames.length
      ? bulletListNode(selectedCapabilityNames)
      : paragraphNode('(none selected)')
  );

  nodes.push(paragraphNode());
  nodes.push(paragraphNode());
  return nodes;
}

// Assembles the final Forms API design JSON: the read-only Exercise
// Information block first, then Participant Information, then the selected
// capabilities in page order - all questions renumbered sequentially with
// matching layout nodes.
function buildFormDesign({ formName, questionBankSections, selectedCapabilityNames, metadata }) {
  const questions = {};
  const layoutContent = [...buildExerciseInfoNodes(metadata, selectedCapabilityNames)];
  let nextId = 1;

  function addSection(sectionTitle) {
    const section = questionBankSections.find((s) => s.title === sectionTitle);
    const rows = extractQuestionRows(section?.table);
    if (!rows.length) return;

    layoutContent.push(headingNode(sectionTitle));
    layoutContent.push(paragraphNode());

    for (const row of rows) {
      const definition = buildQuestionDefinition(row);
      if (!definition) continue;
      const id = String(nextId++);
      questions[id] = definition;
      layoutContent.push(extensionNode(id));
    }

    layoutContent.push(paragraphNode());
  }

  addSection(INTRO_SECTION_TITLE);
  selectedCapabilityNames.forEach(addSection);

  layoutContent.push(paragraphNode());
  layoutContent.push(paragraphNode());

  return {
    settings: {
      name: formName,
      submit: { lock: false, pdf: true },
      primaryLocale: 'en-US'
    },
    questions,
    sections: {},
    conditions: {},
    layout: [{ version: 1, type: 'doc', content: layoutContent }]
  };
}

// Shared pipeline: load the Exercise Designer page, find and parse the
// Question Bank, and assemble the merged Forms design JSON. Used by
// 'getFormDesign' and 'createEvaluationForm' so this logic lives in one place.
async function assembleFormDesignForPage(pageId) {
  const { page, metadata, capabilities } = await loadExercisePage(pageId);

  // Matches on title are exact and case-sensitive against
  // QUESTION_BANK_PAGE_TITLE. If more than one page in the space shares that
  // title, `matches` will have more than one entry - the first is used, and
  // the count is surfaced below for debugging.
  const matches = await findPageIdByTitle(page.spaceId, QUESTION_BANK_PAGE_TITLE);
  const questionBankPageId = matches[0]?.id || null;

  let questionBankSections = [];
  if (questionBankPageId) {
    const response = await api.asApp().requestConfluence(
      route`/wiki/api/v2/pages/${questionBankPageId}?body-format=atlas_doc_format`
    );
    const questionBankPage = await response.json();
    const questionBankBody = questionBankPage.body?.atlas_doc_format?.value
      ? JSON.parse(questionBankPage.body.atlas_doc_format.value)
      : null;
    questionBankSections = splitQuestionBankSections(questionBankBody);
  }

  const selectedCapabilityNames = capabilities.filter((c) => c.selected).map((c) => c.name);

  const exerciseTitle = metadata['Exercise / Event Title']?.text || 'Untitled Exercise';
  const exerciseDateField = metadata['Exercise Date'];
  const exerciseDate =
    exerciseDateField?.kind === 'date' && exerciseDateField.date
      ? exerciseDateField.date.slice(0, 10)
      : 'TBD';
  const formName = `AAR - ${exerciseTitle} - ${exerciseDate}`;

  const design = buildFormDesign({ formName, questionBankSections, selectedCapabilityNames, metadata });

  return {
    page,
    matches,
    questionBankPageId,
    questionBankSections,
    selectedCapabilityNames,
    formName,
    design
  };
}

// Inspection resolver used while building the merge pipeline. Not wired to
// any button currently, kept for manual debugging via invoke() if needed.
resolver.define('getFormDesign', async (req) => {
  const pageId = req.context.extension.content.id;
  const {
    page,
    matches,
    questionBankPageId,
    questionBankSections,
    selectedCapabilityNames,
    formName,
    design
  } = await assembleFormDesignForPage(pageId);

  return {
    spaceId: page.spaceId,
    questionBankMatchCount: matches.length,
    questionBankPageId,
    questionBankSectionTitles: questionBankSections.map((s) => s.title),
    questionBankFound: Boolean(questionBankPageId),
    formName,
    selectedCapabilities: selectedCapabilityNames,
    questionCount: Object.keys(design.questions).length,
    design
  };
});

// ---------------------------------------------------------------------------
// Forms API integration: creates the form and publishes it to a pooled JSM
// request type, using Basic auth rather than Forge's asApp()/asUser() bridge
// or OAuth 2.0 bearer tokens (see README "Forms API auth limitation" for why).
// FORMS_API_EMAIL / FORMS_API_TOKEN currently hold the developer's own
// personal credentials - see the TODO near the top of README.md for swapping
// these for a dedicated OC HCA service account before production use.
// ---------------------------------------------------------------------------

// Hardcoded to the ochdp-test JSM test project's numeric id (the Forms API
// 404s on the project key). Update when moving to the real ochca site.
const PROJECT_KEY = '10001';

// The 3 pre-existing pooled request types this app publishes forms to,
// instead of one request type per exercise. Update when moving to ochca.
const REQUEST_TYPES = [
  { id: '18', name: 'AAR #1' },
  { id: '20', name: 'AAR #2' },
  { id: '21', name: 'AAR #3' }
];

// Builds the direct customer-portal link to a request type's create screen.
// All 3 AAR request types share the same portal/group id on ochdp-test -
// update all three alongside REQUEST_TYPES/PROJECT_KEY for the real site.
const SITE_BASE_URL = 'https://ochdp-test.atlassian.net';
const PORTAL_ID = '2';
const GROUP_ID = '8';

function buildRequestTypeLink(requestTypeId) {
  return `${SITE_BASE_URL}/servicedesk/customer/portal/${PORTAL_ID}/group/${GROUP_ID}/create/${requestTypeId}`;
}

// Forge Storage key for the tracker object: { [requestTypeId]: { inUse,
// formId, formName, pageId, createdAt } }. No entry, or inUse: false, means
// that request type is open.
const TRACKER_STORAGE_KEY = 'requestTypeTracker';

async function getTracker() {
  const tracker = await kvs.get(TRACKER_STORAGE_KEY);
  return tracker || {};
}

async function saveTracker(tracker) {
  await kvs.set(TRACKER_STORAGE_KEY, tracker);
}

async function fetchJsonOrText(response) {
  const bodyText = await response.text();
  try {
    return JSON.parse(bodyText);
  } catch {
    return bodyText;
  }
}

// Returns the current status of all 3 request types (open, or in-use with
// the form/exercise occupying it) for the Confluence page's status list.
resolver.define('getRequestTypeTracker', async () => {
  const tracker = await getTracker();
  return REQUEST_TYPES.map((rt) => ({
    id: rt.id,
    name: rt.name,
    inUse: Boolean(tracker[rt.id]?.inUse),
    ...tracker[rt.id],
    formLink: tracker[rt.id]?.inUse ? buildRequestTypeLink(rt.id) : null
  }));
});

function buildAuthHeader() {
  const email = process.env.FORMS_API_EMAIL;
  const apiToken = process.env.FORMS_API_TOKEN;
  if (!email || !apiToken) {
    throw new Error(
      'Forms API credentials are not configured. Set FORMS_API_EMAIL and FORMS_API_TOKEN via `forge variables set --encrypt`.'
    );
  }
  return 'Basic ' + Buffer.from(`${email}:${apiToken}`).toString('base64');
}

resolver.define('createEvaluationForm', async (req) => {
  const pageId = req.context.extension.content.id;
  const cloudId = req.context.cloudId;

  const tracker = await getTracker();
  const openRequestType = REQUEST_TYPES.find((rt) => !tracker[rt.id]?.inUse);
  if (!openRequestType) {
    return {
      step: 'none',
      ok: false,
      error: 'All request types (AAR #1, #2, #3) are currently in use. Delete an existing form first.'
    };
  }

  const { formName, design } = await assembleFormDesignForPage(pageId);

  const authHeader = buildAuthHeader();
  const formsBaseUrl = `https://api.atlassian.com/jira/forms/cloud/${cloudId}`;
  const commonHeaders = {
    Authorization: authHeader,
    'Content-Type': 'application/json',
    Accept: 'application/json',
    'X-ExperimentalApi': 'opt-in'
  };

  // Step 1: create the form (design only, no request type attached yet).
  const createResponse = await fetch(`${formsBaseUrl}/project/${PROJECT_KEY}/form`, {
    method: 'POST',
    headers: commonHeaders,
    body: JSON.stringify({ design })
  });
  const createBody = await fetchJsonOrText(createResponse);

  if (!createResponse.ok) {
    return {
      step: 'create',
      status: createResponse.status,
      ok: false,
      formName,
      body: createBody
    };
  }

  const formId = createBody?.id;
  if (!formId) {
    return {
      step: 'create',
      status: createResponse.status,
      ok: false,
      formName,
      body: createBody,
      error: 'Form was created but no id was found in the response - cannot publish to a request type.'
    };
  }

  // Step 2: publish the form to the target request type by re-sending the
  // design with a `publish.portal.portalRequestTypeIds` array - this is what
  // makes the form appear under that request type in the JSM portal.
  const publishResponse = await fetch(
    `${formsBaseUrl}/project/${PROJECT_KEY}/form/${formId}`,
    {
      method: 'PUT',
      headers: commonHeaders,
      body: JSON.stringify({
        design,
        publish: {
          jira: {
            recommendedIssueRequestTypeIds: [],
            issueCreateIssueTypeIds: [],
            issueCreateRequestTypeIds: [],
            submitOnCreate: true,
            validateOnCreate: true
          },
          portal: {
            portalRequestTypeIds: [openRequestType.id],
            submitOnCreate: true,
            validateOnCreate: true
          }
        }
      })
    }
  );
  const publishBody = await fetchJsonOrText(publishResponse);

  if (publishResponse.ok) {
    tracker[openRequestType.id] = {
      inUse: true,
      formId,
      formName,
      pageId,
      createdAt: new Date().toISOString()
    };
    await saveTracker(tracker);
  }

  return {
    step: 'publish',
    status: publishResponse.status,
    ok: publishResponse.ok,
    formName,
    formId,
    requestTypeId: openRequestType.id,
    requestTypeName: openRequestType.name,
    formLink: publishResponse.ok ? buildRequestTypeLink(openRequestType.id) : null,
    createBody,
    body: publishBody
  };
});

resolver.define('deleteEvaluationForm', async (req) => {
  const { requestTypeId } = req.payload || {};
  const cloudId = req.context.cloudId;

  const tracker = await getTracker();
  const entry = tracker[requestTypeId];
  if (!entry?.formId) {
    return {
      ok: false,
      error: `No form is currently tracked for request type ${requestTypeId}.`
    };
  }

  const authHeader = buildAuthHeader();
  const formsBaseUrl = `https://api.atlassian.com/jira/forms/cloud/${cloudId}`;

  const deleteResponse = await fetch(
    `${formsBaseUrl}/project/${PROJECT_KEY}/form/${entry.formId}`,
    {
      method: 'DELETE',
      headers: {
        Authorization: authHeader,
        Accept: 'application/json',
        'X-ExperimentalApi': 'opt-in'
      }
    }
  );

  if (!deleteResponse.ok) {
    const body = await fetchJsonOrText(deleteResponse);

    // A 404 means the form is already gone - most likely deleted directly in
    // JSM instead of through this app. Free the tracker entry anyway rather
    // than leaving that request type stuck as "in use" for a form that no
    // longer exists. Any other failure leaves the tracker untouched, since
    // the form may genuinely still exist.
    if (deleteResponse.status === 404) {
      delete tracker[requestTypeId];
      await saveTracker(tracker);
      return {
        ok: true,
        status: deleteResponse.status,
        alreadyDeleted: true,
        requestTypeId,
        body
      };
    }

    return { ok: false, status: deleteResponse.status, body };
  }

  delete tracker[requestTypeId];
  await saveTracker(tracker);

  return { ok: true, status: deleteResponse.status, requestTypeId };
});

export const handler = resolver.getDefinitions();
