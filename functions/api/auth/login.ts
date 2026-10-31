import { Env } from '../../../server/db';
import { runRoute } from '../../../server/http';
import { defaultDeps, postLogin } from '../../../server/routes';

export const onRequestPost: PagesFunction<Env> = ({ request, env }) =>
  runRoute('POST /api/auth/login', request, () => postLogin(request, env, defaultDeps));
