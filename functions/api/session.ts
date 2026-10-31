import { Env } from '../../server/db';
import { runRoute } from '../../server/http';
import { defaultDeps, deleteSessionRoute, postSession } from '../../server/routes';

export const onRequestPost: PagesFunction<Env> = ({ request, env }) =>
  runRoute('POST /api/session', request, () => postSession(request, env, defaultDeps));

export const onRequestDelete: PagesFunction<Env> = ({ request, env }) =>
  runRoute('DELETE /api/session', request, () => deleteSessionRoute(request, env));
