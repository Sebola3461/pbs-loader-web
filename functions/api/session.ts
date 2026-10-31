import { Env } from '../../server/db';
import { runRoute } from '../../server/http';
import { defaultDeps, deleteSessionRoute } from '../../server/routes';

export const onRequestDelete: PagesFunction<Env> = ({ request, env }) =>
  runRoute('DELETE /api/session', request, () => deleteSessionRoute(request, env));
