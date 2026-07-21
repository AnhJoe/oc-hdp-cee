Orange County Health Care Agency (OC HCA) - Health Disaster Preparedness (HDP) - Capability-based Evaluation Engine (CEE).

A Confluence Forge app that generates After Action Review (AAR) evaluation forms for the Agency Operations Center (AOC)
training exercises. Instructors select exercise type, hazards, CDC PHEP capabilities, and RRF priority areas on an
Exercise Designer page; this app reads that page's content and will use it to assemble a matching evaluation form
via the Atlassian Forms REST API, published to the JSM service desk portal for participants to complete.

Objectives:
1) Read exercise metadata and capability/objective selections directly from the Exercise Designer Confluence page.
2) Merge the selected CDC PHEP capability questions (stored in the Confluence question bank) into a single form
   design JSON.
3) Create and publish that form as a new service desk request type via the Atlassian Forms REST API, named
   per exercise ("AAR - [Exercise Name] - [Date]"), and return a direct link to instructors.
4) Keep the platform simple and staff-handoff friendly - minimal scopes, deterministic JSON parsing/merging,
   Rovo/LLM use reserved only for AAR summarization once submissions come in.

Build & Testing Phases:
1) Proof of concept (done) - macro button calls a resolver that fetches basic page metadata (id, title, status)
   from the Exercise Designer page via Confluence API, confirming the macro, resolver, and permissions wiring
   all work end to end.
2) Page body extraction (in progress) - resolver now requests the page body in Atlas Document Format (ADF) and
   returns it to the macro, which renders the raw ADF tree so we can see how the Exercise Designer's metadata and
   capability/objective selections are actually structured in the content. This drives the extraction logic in the
   next phase.
3) Metadata & capability extraction (next) - replace the raw ADF dump with real parsing logic that walks the ADF
   tree and pulls out exercise metadata and selected CDC PHEP capabilities/RRF priority areas into a clean object.
4) Form generation pipeline (planned) - query the Confluence question bank for the selected capabilities, merge
   their questions into one Forms design JSON, and call the Forms REST API to create the form template.
5) Request type publishing (planned) - create/publish the request type on the AIF service desk portal following
   the pooled request type + exercise-identity-in-form-fields pattern, and return the link to the instructor.
6) Rovo agent pipeline (planned) - configure Rovo agents for AAR summarization and improvement task generation
   from submitted evaluation forms.

Documentation:
1) https://developer.atlassian.com/platform/forge/getting-started/

Procedures:
1) forge deploy = push app files to connected developer space
2) forge install, platform = Confluence, URL = https://ochdp-test.atlassian.net, y, y

Changes to:
1) Backend resolver (src/index.js) = forge deploy
2) Frontend (static/cee/src/...) = cd static/cee && npm run build && cd ../.. && forge deploy
3) manifest.yml - new scopes, new modules, new permissions = forge deploy then forge install -- upgrade
4) manifest.yml - tweak existing values = forge deploy
5) For faster, active backend development - runs backend locally and stream changes to live marco instantly = forge tunnel
   1) Ctrl+c in terminal to stop

Troubleshooting:
1) forge deploy
   1) Error: manifest.yml is missing the property app or permission issues
   2) check the manifest.yml, app: id: ari:cloud:ecosystem::app/{uuid of dev space}
2) forge deploy
   1) Error: error missing resource 'static/cee/build' is being referenced by 'main' in resources  valid-resource-required
   2) cd static/cee, npm install --legacy-peer-deps, npn run build
3) forge deploy
   1) Error: Bundling failed: Module not found: Error: Can't resolve '@forge/api' in 'C:\Users\joetn\hdp-cee\src'
   2) cd hdp-cee, npm install @forge/api