Documentation:
1) https://developer.atlassian.com/platform/forge/getting-started/

Procedures:
1) forge deploy = push app files to connected developer space
2) forge install, platform = Confluence, URL = https://ochdp-test.atlassian.net, y, y
3) 

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