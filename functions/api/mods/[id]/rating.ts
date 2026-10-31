import { Env } from '../../../../server/db';
import { runRoute } from '../../../../server/http';
import { defaultDeps, deleteRating, putRating } from '../../../../server/routes';

export const onRequestPut: PagesFunction<Env, 'id'> = ({ request, env, params }) =>
  runRoute('PUT /api/mods/:id/rating', request, () =>
    putRating(request, env, defaultDeps, params.id),
  );

export const onRequestDelete: PagesFunction<Env, 'id'> = ({ request, env, params }) =>
  runRoute('DELETE /api/mods/:id/rating', request, () =>
    deleteRating(request, env, defaultDeps, params.id),
  );
