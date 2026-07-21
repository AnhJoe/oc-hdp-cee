import Resolver from '@forge/resolver';
import api, { route } from '@forge/api';

const resolver = new Resolver();

resolver.define('getPageInfo', async (req) => {
  const pageId = req.context.extension.content.id;

  const response = await api.asApp().requestConfluence(
    route`/wiki/api/v2/pages/${pageId}`
  );
  const page = await response.json();

  return {
    id: page.id,
    title: page.title,
    status: page.status
  };
});

export const handler = resolver.getDefinitions();