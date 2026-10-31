import { Env } from '../../server/db';
import { runRoute } from '../../server/http';
import { defaultDeps, postSubmission } from '../../server/routes';

export const onRequestPost: PagesFunction<Env> = ({ request, env }) =>
  runRoute('POST /api/submissions', request, () => postSubmission(request, env, defaultDeps));
