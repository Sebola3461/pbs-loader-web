import { Env } from '../../../server/db';
import { runRoute } from '../../../server/http';
import { defaultDeps, postRegister } from '../../../server/routes';

export const onRequestPost: PagesFunction<Env> = ({ request, env }) =>
  runRoute('POST /api/auth/register', request, () => postRegister(request, env, defaultDeps));
