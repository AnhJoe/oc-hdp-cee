Orange County Health Care Agency (OC HCA) - Health Disaster Preparedness (HDP) - Capability Evaluation Engine (CEE).

---

TODO (blocking before production use) #1 - service account: the Forms API create-form call currently
authenticates with the developer's own personal Atlassian credentials (Basic auth, stored as Forge variables
FORMS_API_EMAIL / FORMS_API_TOKEN), used only to prove out the rest of the workflow end to end. Before this
app is handed off or used against the real ochca site, OC HCA needs to provision a dedicated,
non-personal service account (not tied to any one person's login) with just enough permission to manage
forms/request types on the relevant JSM project, and generate an API token for it. Once that account exists:
1) Log into id.atlassian.com/manage-profile/security/api-tokens as the service account and generate its token.
2) Run `forge variables set --encrypt FORMS_API_EMAIL` and `forge variables set --encrypt FORMS_API_TOKEN`
   locally with the service account's email and token - this overwrites the personal credentials currently stored
   under those same variable names, `forge deploy` afterward.

TODO (blocking before production use) #2 - hardcoded test project: the create-form call currently targets a
hardcoded JSM project ID ('10001', the 'TS' test project on ochdp-test) via the PROJECT_KEY
constant in src/index.js. Before this app is used against ochca site, update PROJECT_KEY to the real
target JSM project's numeric id on that site (look it up the same way this one was found - GET
/rest/api/3/project/search against that site's cloudId).

TODO (blocking before production use) #3 - hardcoded request types: the request type tracker (auto-pick an
open AAR #1/#2/#3, track in-use forms, delete to free one up) is built and working. What's still hardcoded is 
the REQUEST_TYPES list itself (ids/names for AAR #1/#2/#3 on ochdp-test) in src/index.js. Before this app is used 
against ochca site, update that list to the real request type ids on that site (look them up the same way 
these were found - GET /rest/servicedeskapi/servicedesk/{id}/requesttype against that site's cloudId/service desk).

---
# Summary:
A Confluence Forge app that generates After Action Review (AAR) evaluation forms for training exercises.
Instructors select exercise type, hazards, and CDC PHEP capabilities on an Exercise Designer page; this app reads
that page's content and assembles a matching evaluation form via the Atlassian Forms REST API, published to a
JSM service desk portal for participants to complete.

# Objectives:
1) Read exercise metadata and capability/objective selections directly from the Exercise Designer Confluence page.
2) Merge the selected CDC PHEP capability questions (stored in the Confluence question bank) into a single form
   design JSON.
3) Create and publish that form as a new service desk request type via the Atlassian Forms REST API, named
   per exercise ("AAR - [Exercise Name] - [Date]"), and return a direct link to instructors.

# Standing up an independent app:
This repo currently deploys to one specific Forge app registration, tied to whoever ran `forge register` for
it (the `id:` field in manifest.yml). App IDs aren't transferable between Atlassian accounts, so if you're not
collaborating directly on that existing app, you'll need your own independent app before any of 
"Setup for your own site" applies:
1) Get an Atlassian account and a Cloud site to develop against. If you don't already have one, sign up at
   https://id.atlassian.com and create a free, non-production developer site with Confluence and Jira Service 
   Management enabled - this app needs both. A direct signup link that provisions a test site with the right 
   products already flagged as a developer instance: https://go.atlassian.com/cloud-dev 
2) Install the Forge CLI and log in: `npm install -g @forge/cli`, then `forge login` with that account's
   credentials.
3) Clone this repo, then run `forge register` from its root to mint a brand-new app under your own account.
   This replaces the `id:` field in manifest.yml with your new app's ID - from this point on, the app is
   entirely yours to deploy, install, and manage independently of the original.
4) Continue with "Setup for your own site" below - deploy, install against your site, provision your own
   Forms API service account, mirror the required Confluence pages, and update the hardcoded JSM identifiers.

Forge apps also come with development/staging/production environments by default (`forge deploy -e
development`), so you can iterate against your site without touching whatever install real users see.
See https://developer.atlassian.com/platform/forge/getting-started/ for more details.

## Setup for your own site:
This app was built and tested against a specific Confluence/JSM site, JSM project, and a small pool of
pre-created request types - none of that is portable as-is. Getting it running on a new site takes four things:
1) Deploy and install the app. Standard Forge workflow: `forge login`, `forge deploy`, then
   `forge install` and choose Confluence as the product and your site as the target. All Forms/JSM calls in
   this app go over a plain external fetch() rather than Forge's native product bridge.
2) Provision a dedicated, non-personal Atlassian account (not tied to any one developer's login) to call the
   Forms API with, and generate an API token for it at id.atlassian.com/manage-profile/security/api-tokens.
   Store its email and token as encrypted Forge variables: `forge variables set --encrypt FORMS_API_EMAIL` and
   `forge variables set --encrypt FORMS_API_TOKEN`, then `forge deploy` (variable changes don't take effect
   until the app is redeployed). buildAuthHeader() in src/index.js reads these from process.env - see "Rotating
   the Forms API credential" below for how to update them later.
3) Mirror the two Confluence pages this app expects:
   - An "Exercise Designer" page (or whatever page the macro is added to) containing a metadata table with
     "Field" as its first header, and a capability table with "Capability" as its first header. The metadata
     table can have any number of rows - more can be added later with no code change needed. Cell values
     can be plain text, a date field, or a checkbox/taskList; see extractMetadata/extractCapabilities in the
     function map below for exactly what's expected.
   - An "AAR Question Bank" page (title configurable via QUESTION_BANK_PAGE_TITLE), with a "Participant
     Information" section (configurable via INTRO_SECTION_TITLE) and one section per CDC PHEP capability. Each
     section is a heading followed immediately by a table with "Question Text" as its first header. Capability
     section headings must match the capability names spelled out on the Exercise Designer page exactly.
4) Set up your own JSM project and request types, then point the hardcoded identifiers in src/index.js at
   them:
   - PROJECT_KEY - the target JSM project's numeric ID (not its key) - look it up via
     GET /rest/api/3/project/search on your site.
   - REQUEST_TYPES - a small pool of request types (e.g. 3), manually created ahead of time in the JSM
     project and attached to a portal group - see "Request type provisioning" below for why this has to be
     done manually rather than through the app. Find their ids via
     GET /rest/servicedeskapi/servicedesk/{id}/requesttype.
   - SITE_BASE_URL/PORTAL_ID/GROUP_ID - used only to build direct customer-portal links back to a created
     form; PORTAL_ID and GROUP_ID come from the same servicedesk/requesttype lookup above.
   See function map items 20, 21, and 21a below for exactly what each constant does.

## Adding the macro to a Confluence page:
Once the app is deployed and installed on a site, it still needs to be placed on the actual
Exercise Designer page before it'll do anything - installing the app does not add it to any page automatically.
1) Open the Exercise Designer page in Confluence and click "Edit" (or create a new page for this if none
   exists yet).
2) Place the cursor where you want the macro's button to appear, then either type `/` to open the insert
   menu or click the "+" (Insert) button in the editor toolbar.
3) Search for "Generate Evaluation Form" (the macro's title, set in manifest.yml under modules.macro) and
   select it. It'll drop into the page as a small macro block.
4) Publish the page. The macro now renders its "Create Form" button and "Request Type Status" list right on
   that page, reading whatever metadata/capabilities/question bank content exists at the time someone clicks
   Create Form.
The macro can be added to more than one page, but each one reads its own page's metadata/capabilities table
independently - there's no cross-page state beyond the shared request type tracker (which is global, not
per-page, since it tracks the shared pool of request types across all exercises).

## Example pages (Exercise Designer & Question Bank):
Read-only, view-only share links to a working Exercise Designer page and AAR Question Bank page, for reference
on the table structure/section layout described above. These are Confluence's public "share via link" links -
they're anonymous and view-only by design, not an editing surface, so use them just to see the expected shape
of each page.
1) Exercise Designer example: https://ochdp-test.atlassian.net/wiki/external/YmNhMzViNmJkYmE5NDFiYTgxMzM0MzZkNGEwMDE4MDY
2) AAR Question Bank example: https://ochdp-test.atlassian.net/wiki/external/OGIxZDE5ZGY5OWYzNDg4NGFiZGMyYWUxYzliMTM0ZDc

## Request type provisioning (why request types are pre-created manually):
The original plan was to have the app itself create a portal group and a request type per exercise through the
Forms/JSM REST APIs, so no manual JSM setup would be needed at all. That turned out not to be possible: portal
group creation and request type edit/update calls (POST/PUT against
/rest/servicedeskapi/servicedesk/{id}/requesttype and the portal-group equivalents) were rejected regardless of
the auth method or scopes tried - these operations simply aren't exposed the same way form create/publish/delete
are. The workaround is what this app actually does: a small pool of request types (e.g. AAR #1/#2/#3) is created
once, directly in the JSM project, and manually attached to a portal group so they're visible on the
customer portal. The request type tracker (see function map items 22-23 below) then manages which of that pre-existing
pool is in use, rather than the app provisioning new ones on demand. This is why REQUEST_TYPES has to be set up and 
populated manually for a new site rather than being derived automatically.

# Build & Testing Phases:
1) Proof of concept - macro button calls a resolver that fetches basic page metadata (id, title, status)
   from the Exercise Designer page via Confluence API, confirming the macro, resolver, and permissions wiring
   all work end to end.
2) Page body extraction - resolver now requests the page body in Atlas Document Format (ADF) and
   returns it to the macro, which renders the raw ADF tree so we can see how the Exercise Designer's metadata and
   capability/objective selections are actually structured in the content. This drives the extraction logic in the
   next phase.
3) Metadata & capability extraction - replace the raw ADF dump with real parsing logic that walks the ADF
   tree and pulls out exercise metadata and selected CDC PHEP capabilities/RRF priority areas into a clean object.
4) Form generation pipeline - resolver reads the AAR Question Bank page (Participant Information intro
   section always included, plus every selected capability), merges their questions into one Forms design JSON
   matching the Forms API's expected shape, and renumbers everything sequentially with matching layout nodes
   (capability section titles render as real ADF headings, not plain paragraphs). The 'createEvaluationForm'
   resolver ("Create Form" button) runs the full pipeline in one call: create the form
   (POST .../project/{id}/form), then publish/attach it to a request type in the same request
   (PUT .../project/{id}/form/{formId} with a `publish.portal.portalRequestTypeIds` array). Every generated
   form also opens with a read-only "Exercise Information" block (see buildExerciseInfoNodes) showing all of
   the exercise's metadata fields and its selected capabilities, so participants have that context before
   answering questions - this reads whatever fields actually exist in the metadata table dynamically, so
   instructors can add new rows to the Exercise Designer's metadata table in the future with no code change
   needed.
5) Request type tracker - supports a small pool of pre-existing, pre-provisioned request types (e.g.
   AAR #1/#2/#3, all under the same portal group on the JSM project) instead of creating a new request type per
   exercise. Built using Forge Key-Value Storage to track which of the pool is currently in use (by which
   form/exercise page). 'createEvaluationForm' auto-picks the first open request type instead of a hardcoded
   one, and returns an error instead of calling the Forms API at all if the whole pool is full. The Confluence
   page shows live status for every pooled request type (open, or in-use with the attached form's name) via
   'getRequestTypeTracker', refreshed after every create/delete. A "Delete Form" button next to each in-use
   request type calls 'deleteEvaluationForm', which removes the form via the Forms API and frees that request
   type's tracker entry back to open.

# Architecture & Maintenance Guide:

## File map:
1) src/index.js - all backend logic (the Forge resolver function). Reads Confluence pages via ADF, parses them,
   and builds the Forms API design JSON. No UI code lives here.
2) static/cee/src/App.js - the macro's frontend (Custom UI/React). Calls the resolver via invoke() and renders
   results. Never touches Confluence/Forms REST APIs directly - all of that stays in the resolver.
3) static/cee/src/index.js - standard Create React App entry point that mounts App.js. Rarely needs changes.
4) manifest.yml - macro definition, resolver function binding, permission scopes, resource path, app id.

## Function map (src/index.js):
1) extractText(node) - flattens any ADF node's nested text content into a plain string. Foundation helper used
   by everything else that reads a table cell or heading.
2) getHeaderLabels(table) - reads a table's header row into column label strings, so tables are identified by
   header text instead of fragile localIds (localIds regenerate if a page is ever recreated).
3) readCell(cell) - reads one table cell into a tagged value: {kind:'text'}, {kind:'date'}, or {kind:'choices'}
   depending on whether the cell holds a plain paragraph, an inline date node, or a taskList (checkbox field).
4) extractMetadata(table) - walks the Exercise Designer's "Field | Instructor Entry | Guidance" table into a
   {label: value} object.
5) extractCapabilities(table) - walks the "Capability | Select | Notes" table into a list of {name, selected}.
6) loadExercisePage(pageId) - fetches a page's ADF and returns its parsed {page, metadata, capabilities}. Shared
   by both resolvers below so the parsing logic only lives in one place.
7) resolver 'getPageInfo' - called by the "Generate Evaluation Form" button; returns page id/title/status plus
   parsed metadata/capabilities, for on-page inspection.
8) QUESTION_BANK_PAGE_TITLE / INTRO_SECTION_TITLE - the configured page/section names ("AAR Question Bank",
   "Participant Information"). Update these constants if either gets renamed in Confluence.
9) RATING_CHOICES - the fixed 1-5 scale applied to every "Rating (1-5)" question. Edit this array to change the
   scale's wording or point count platform-wide.
10) ANSWER_TYPE_MAP - maps the plain-language "Answer Type" column value an admin types in the question bank to
    the Forms API's internal type code. This is the single place to add a new answer type or fix a type code if
    Atlassian's API changes it. Every entry here is available in every section (Participant Information and every
    capability) automatically - there is no per-section type restriction anywhere in the code.
11) CHOICE_DRIVEN_ANSWER_TYPES - the subset of answer types whose Choices column gets parsed into semicolon-
    separated options. Add a new type's name here if it should also support custom choice lists.
12) findPageIdByTitle(spaceId, title) - looks up a page by exact title within a space; used to find the question
    bank page regardless of which space it lives in.
13) splitQuestionBankSections(doc) - splits the Question Bank page into {title, table} blocks by pairing each
    heading with the table immediately after it.
14) extractQuestionRows(table) - walks one section's "Question Text | Answer Type | Required | Choices" table
    into plain question-row objects, skipping incomplete rows.
15) buildQuestionDefinition(row) - converts one question-bank row into a Forms API question object; returns null
    (skipped safely) if an admin used an Answer Type value not in ANSWER_TYPE_MAP.
16) paragraphNode / headingNode / extensionNode - small builders for the ADF node shapes used in the generated
    form's layout: a text/blank paragraph, a section-title heading (level 2 by default, matching the
    validated POST example - section titles must be a real ADF heading node, not a paragraph, or they don't
    render as headings in the created form), and a question-extension reference.
16a) formatMetadataValue(value) / labeledParagraphNode(label, valueText) / bulletListNode(items) /
    boldParagraphNode(text) - additional builders/formatters used only by buildExerciseInfoNodes below, for
    the read-only "Exercise Information" block at the top of every generated form. formatMetadataValue mirrors
    the old frontend renderFieldValue helper (text/date/choices tagged values -> plain string) but lives here
    now since the design layout itself needs it, not just the UI.
16b) buildExerciseInfoNodes(metadata, selectedCapabilityNames) - builds the read-only intro block: an "Exercise
    Information" heading, one labeled paragraph per metadata field, then a "Selected Capabilities" bullet list.
    Iterates over whatever fields actually exist in `metadata` rather than hardcoding field names, so if an
    instructor adds a new row to the Exercise Designer's metadata table, it automatically appears here with no
    code change needed. All nodes here are plain paragraph/heading/bulletList nodes (never extension/question
    nodes), so none of it is fillable/editable by participants - it's read-only by construction.
17) buildFormDesign(...) - assembles the final design JSON: buildExerciseInfoNodes' read-only block always
    first, then Participant Information, then the selected capabilities in page order, renumbering all
    questions sequentially with matching layout nodes. Now takes `metadata` as a parameter alongside formName/
    questionBankSections/selectedCapabilityNames.
18) assembleFormDesignForPage(pageId) - shared pipeline (load exercise page, load/parse question bank, merge)
    used by both resolvers below, so this logic only lives in one place.
19) resolvers 'getPageInfo' / 'getFormDesign' - kept intentionally as debugging options, not dead code. These
    were the original inspection resolvers used to build and verify the extraction/merge pipeline (page
    metadata+capabilities, and the merged design JSON with debugging fields like questionBankMatchCount). No
    button in App.js calls them anymore ("Generate Evaluation Form" and "Preview Form Design" were removed
    once createEvaluationForm was trusted), but if the pipeline ever needs to be inspected by hand again,
    temporarily add a button calling invoke('getPageInfo') or invoke('getFormDesign') (see the old App.js
    pattern in git history) rather than re-deriving this logic from scratch.
20) PROJECT_KEY - the JSM project the create-form call targets, as a numeric project ID (the Forms API 404s
    with PROJECT_NOT_FOUND if given the project key instead - look the numeric ID up via
    GET /rest/api/3/project/search on your site). Hardcoded; update it for your own JSM project (see "Setup for
    your own site" above).
21) REQUEST_TYPES - the pooled request types (e.g. AAR #1/#2/#3) that createEvaluationForm publishes forms to,
    found via GET /rest/servicedeskapi/servicedesk/{id}/requesttype. Hardcoded; these must be manually created
    in JSM and attached to a portal group ahead of time (see "Request type provisioning" above) and then listed
    here for your own site.
21a) SITE_BASE_URL / PORTAL_ID / GROUP_ID / buildRequestTypeLink(requestTypeId) - builds the direct
    customer-portal link to a request type's create screen
    (https://{site}/servicedesk/customer/portal/{portalId}/group/{groupId}/create/{requestTypeId}), returned to
    the UI as createResult.formLink after a successful create+publish. These three values need updating
    alongside REQUEST_TYPES/PROJECT_KEY when deploying to your own site.
22) TRACKER_STORAGE_KEY / getTracker() / saveTracker(tracker) - the Forge Key-Value Storage key and small
    read/write helpers for the request type tracker object ({ [requestTypeId]: { inUse, formId, formName,
    pageId, createdAt } }). Request types with no entry, or inUse: false, are open. Uses the `kvs` client from
    the `@forge/kvs` package (not the deprecated `storage` export from `@forge/api`) - requires the
    `storage:app` permission scope in manifest.yml.
23) resolver 'getRequestTypeTracker' - called on page load (and after every create/delete) by the macro;
    returns all 3 REQUEST_TYPES merged with their current tracker status, plus a formLink (via
    buildRequestTypeLink) for any in-use request type, for the "Request Type Status" list.
24) buildAuthHeader() - builds the Basic auth header from FORMS_API_EMAIL / FORMS_API_TOKEN, shared by both
    createEvaluationForm and deleteEvaluationForm so the credential-reading logic only lives in one place.
25) fetchJsonOrText(response) - small helper that parses a fetch Response body as JSON, falling back to raw
    text if it isn't valid JSON (the Forms API can return either depending on the error).
26) resolver 'createEvaluationForm' - called by the "Create Form" button. First checks the tracker for an open
    request type (REQUEST_TYPES.find where not in use) - if the whole pool is full, returns step:'none' with
    an error and never calls the Forms API. Otherwise runs the two-step pipeline using Basic auth from
    buildAuthHeader() (see "Setup for your own site" above about provisioning the service account this reads
    its credentials from):
    a) assembleFormDesignForPage, then POST the resulting design to
       api.atlassian.com/jira/forms/cloud/{cloudId}/project/{PROJECT_KEY}/form to create the form and get its
       id back.
    b) PUT the same design plus a `publish` object to .../project/{PROJECT_KEY}/form/{formId}, with
       `publish.portal.portalRequestTypeIds: [openRequestType.id]` - this is what actually makes the form
       appear under that request type in the JSM portal.
    If step (a) fails or doesn't return an id, the resolver returns early with step:'create' and does not
    attempt step (b) or touch the tracker. On a successful publish, writes that request type's tracker entry
    (inUse: true, formId, formName, pageId, createdAt) before returning step:'publish' plus the form id,
    request type id/name, a direct portal link via buildRequestTypeLink (formLink), and both steps' response
    bodies for inspection.
27) resolver 'deleteEvaluationForm' - called by each in-use request type's "Delete Form" button, with
    { requestTypeId } as payload. Looks up that request type's formId in the tracker, DELETEs the form via
    .../project/{PROJECT_KEY}/form/{formId} (confirmed working via Postman), then clears that tracker entry
    back to open on success. Returns an error (without calling the API) if nothing is tracked for that
    request type. If the DELETE call itself returns 404 (the form no longer exists - e.g. someone deleted it
    directly in JSM instead of through this app, so the tracker had drifted out of sync), treats that as an
    already-completed delete: frees the tracker entry anyway (returning ok:true, alreadyDeleted:true) rather
    than leaving that request type permanently stuck as "in use" for a form that's already gone. Any other
    failure status leaves the tracker untouched, since the form may genuinely still exist.

## Function map (static/cee/src/App.js):
1) App component - holds three independent pieces of state/actions: createResult + handleCreateForm wired to
   "Create Form" / createEvaluationForm, which creates the form and publishes it to whichever request type the
   tracker says is open; tracker + loadTracker/handleDeleteForm wired to getRequestTypeTracker /
   deleteEvaluationForm for the "Request Type Status" list and its per-row "link" (formLink, so instructors can
   get back to an already-created form without recreating it) and "Delete Form" buttons. The earlier "Generate
   Evaluation Form" (getPageInfo) and "Preview Form Design" (getFormDesign) buttons/state were removed once
   createEvaluationForm was trusted enough to be the only action needed - their resolvers still exist in
   src/index.js (see function map item 19 there) if manual inspection is ever needed again, just not wired to
   any UI. createResult now only surfaces formName, requestTypeName/Id, and formLink - the raw
   status/step/ok/formId debug fields and the full JSON response dump were dropped once the pipeline was
   trusted.
2) loadTracker() - fetches getRequestTypeTracker and stores it; called on mount (useEffect) and again after
   every create/delete, so the displayed status never goes stale.

# Where to make changes:
1) Question Bank page or intro section renamed in Confluence -> update QUESTION_BANK_PAGE_TITLE /
   INTRO_SECTION_TITLE in src/index.js.
2) Exercise Designer table headers change (e.g. "Field"/"Capability" retitled) -> update the
   getHeaderLabels(t)[0] === '...' checks inside loadExercisePage.
3) Question Bank table columns change (e.g. a 5th column added) -> update the cells[0..3] indexing in
   extractQuestionRows.
4) New Answer Type needed (e.g. "Short Text", "People Picker") -> add it to ANSWER_TYPE_MAP with its Forms API
   type code, and to CHOICE_DRIVEN_ANSWER_TYPES if it should read the Choices column.
5) Rating scale wording or point count changes -> edit RATING_CHOICES.
6) Capability list changes (add/remove/rename a CDC PHEP capability) -> no code change needed; extractCapabilities
   and buildFormDesign both read whatever rows/headings actually exist - just keep capability names spelled
   identically between the Exercise Designer's capability table and the Question Bank's section headings.
7) Form naming convention changes (currently "AAR - [Exercise Title] - [Date]") -> edit the formName line inside
   assembleFormDesignForPage.
8) Forms API integration - wired up via the 'createEvaluationForm' resolver (Basic auth via a dedicated service
   account, see "Setup for your own site" above). See "Forms API auth limitation" below for why Basic auth was
   chosen over OAuth 2.0 (3LO) bearer tokens or Forge's native asApp() bridge - both were tested and ruled out
   against this specific endpoint.
9) Forms API egress permission (external.fetch.backend: https://api.atlassian.com in manifest.yml) is required
   for createEvaluationForm's raw fetch() call - if this permission is ever removed, that call will fail.

# Forms API auth limitation:
The Forms/Proforma REST API (api.atlassian.com/jira/forms/cloud/{cloudId}/...) is an experimental Atlassian
API, and it appears to reject OAuth 2.0 (3LO) bearer tokens outright, regardless of scope - this isn't clearly
documented in Atlassian's public docs. This was confirmed empirically: an OAuth 2.0 (3LO) app was registered
with a broad set of Jira/JSM scopes, a full authorization-code flow was completed against a JSM
site, and the resulting bearer token was verified valid and correctly scoped (via
GET https://api.atlassian.com/oauth/token/accessible-resources, and by successfully calling a plain Jira REST
endpoint like /rest/api/3/project/search with the same token). Despite that, calling the Forms API with the
identical token returned a generic 401 with no scope detail - unlike other Jira/JSM endpoints, which name the
specific missing scope when a token lacks one. That difference points to the Forms API simply not accepting
OAuth 2.0 bearer tokens as an auth method, rather than any scope or configuration mistake.
This rules out a durable OAuth 2.0 app, not tied to any one person's account approach for Forms API calls
specifically. See "Remaining auth options" below for more information.

## Remaining auth options for the Forms API create/read/publish calls:
1) Native Forge api.asApp()/api.asUser() bridge - tested and ruled out. Calling the Forms API through Forge's
   native product bridge (api.asApp().requestJira(...)) returned the same generic
   401 "Unauthorized; scope does not match" regardless of which Jira/JSM manifest scopes were granted, across
   many combinations tried and redeployed. A control call to a plain Jira endpoint
   (api.asApp().requestJira(route`/rest/api/3/myself`)) was used to confirm the bridge itself, and the app's
   product installation, were both working correctly (once the app was also installed against the Jira
   product on the test site, not just Confluence - Forge apps can be installed against multiple products on
   one site, and this app needs to be installed against whichever product the JSM project actually lives on).
   With the bridge and installation both confirmed healthy, the Forms API still rejected every native-bridge
   call the same way, which isolates the problem to the Forms/Proforma API itself rejecting Forge's native
   asApp() bridge for this call. This path is closed; revisiting it would need new information directly from 
   Atlassian about what auth methods this experimental API supports.
2) Dedicated non-personal service/bot account with Basic auth (email + API token) - this is what the app uses
   today. Not OAuth, but also not tied to a personal account once a shared service account is provisioned (see
   "Setup for your own site" above). The API token lives in Forge variables (encrypted), rotated by whoever owns
   the service account going forward - see "Rotating the Forms API credential" below.

# Rotating the Forms API credential:
FORMS_API_EMAIL / FORMS_API_TOKEN are read from process.env in buildAuthHeader() (src/index.js), so no code
changes are needed to rotate them - only the stored Forge variables need updating:
1) Generate a new API token for the service account at id.atlassian.com/manage-profile/security/api-tokens.
2) Run `forge variables set --encrypt FORMS_API_TOKEN` (and FORMS_API_EMAIL, if the account itself changed)
   with the new value.
3) Run `forge deploy` - variable changes don't take effect until the app is redeployed.

# Documentation & Training References:
1) https://developer.atlassian.com/platform/forge/getting-started/
2) https://community.atlassian.com/learning/path/getting-the-most-out-of-confluence
3) https://community.atlassian.com/learning/path/get-the-most-out-of-forge
4) https://community.atlassian.com/learning/path/get-the-most-out-of-jira 
5) https://community.atlassian.com/learning/path/get-the-most-out-of-jira-service-management

## Forge platform reference:
6) https://developer.atlassian.com/platform/forge/manifest-reference/ - manifest.yml fields (modules,
   permissions, scopes, egress).
7) https://developer.atlassian.com/platform/forge/cli-reference/ - `forge deploy`, `forge install`,
   `forge variables set`, and other CLI commands used throughout setup and credential rotation.
8) https://developer.atlassian.com/platform/forge/custom-ui/bridge/ - `@forge/bridge` and `invoke()`, used by
   static/cee/src/App.js to call the backend resolver.
9) https://developer.atlassian.com/platform/forge/kvs-api-reference/ - `@forge/kvs`, used by the request type
   tracker (getTracker/saveTracker).

## Atlassian REST APIs used by this app:
10) https://developer.atlassian.com/cloud/confluence/rest/v2/intro/ - Confluence REST API v2, used to read the
    Exercise Designer and Question Bank page bodies.
11) https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/ - Atlas Document Format (ADF)
    node reference; every node type the parsers in src/index.js walk (heading, table, taskList, date, etc.)
    comes from this doc.
12) https://developer.atlassian.com/cloud/jira/platform/rest/v3/intro/ - Jira Cloud REST API v3, used to look
    up a JSM project's numeric ID for PROJECT_KEY.
13) https://developer.atlassian.com/cloud/jira/service-desk/rest/intro/ - Jira Service Management REST API,
    used to look up service desks and request types for REQUEST_TYPES/PORTAL_ID/GROUP_ID.

Note: the Forms/Proforma API (api.atlassian.com/jira/forms/cloud/...) that createEvaluationForm/
deleteEvaluationForm call has no public reference doc as of this writing - its request/response shapes were
worked out through direct testing rather than documentation.