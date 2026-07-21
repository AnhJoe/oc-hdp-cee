import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';

const resolver = new Resolver();

// Recursively flattens all `text` node content under an ADF node into a
// single string. Used for reading labels and free-text field values out of
// table cells (which are usually a single paragraph wrapping one text node).
function extractText(node) {
  if (!node) return '';
  if (node.type === 'text') return node.text || '';
  if (!node.content) return '';
  return node.content.map(extractText).join('');
}

// Reads the header row of a table into an array of plain-text column labels,
// so we can identify which table is which by header text rather than by
// localId (localIds regenerate whenever the page content is recreated).
function getHeaderLabels(table) {
  const headerRow = table.content?.[0];
  return (headerRow?.content || []).map((cell) => extractText(cell).trim());
}

// Reads a table cell's value. A cell is one of three shapes on this page:
//   - a taskList (converted from checkboxes) for single/multi-select fields
//     and for the capability "Select" column
//   - a paragraph containing an inline `date` node for the Exercise Date field
//   - a plain paragraph of free text for every other field
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

// Walks the "Field | Instructor Entry | Guidance" table into a plain object
// keyed by field label (e.g. "Instructor Name", "Exercise Date", "Hazard
// Category"), skipping the header row.
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

resolver.define('getPageInfo', async (req) => {
  const pageId = req.context.extension.content.id;

  // Request the page with its body in Atlas Document Format (ADF) so we can
  // read the Exercise Designer's metadata table and capability selections
  // directly out of the page content. `read:page:confluence` already covers
  // body retrieval in API v2, so no manifest scope change or re-install is
  // needed for this.
  const response = await api.asApp().requestConfluence(
    route`/wiki/api/v2/pages/${pageId}?body-format=atlas_doc_format`
  );
  const page = await response.json();

  // The ADF body comes back as a JSON string, not a parsed object.
  const adfBody = page.body?.atlas_doc_format?.value
    ? JSON.parse(page.body.atlas_doc_format.value)
    : null;

  // Both tables on the page are identified by their header row text rather
  // than by localId, since localIds regenerate if the page content is ever
  // recreated but the header labels are part of the stable page template.
  const tables = (adfBody?.content || []).filter((n) => n.type === 'table');
  const metadataTable = tables.find((t) => getHeaderLabels(t)[0] === 'Field');
  const capabilityTable = tables.find((t) => getHeaderLabels(t)[0] === 'Capability');

  return {
    id: page.id,
    title: page.title,
    status: page.status,
    metadata: extractMetadata(metadataTable),
    capabilities: extractCapabilities(capabilityTable)
  };
});

export const handler = resolver.getDefinitions();