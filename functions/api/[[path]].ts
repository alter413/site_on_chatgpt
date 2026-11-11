import { handleRequest, type Env } from '../../server/gateway';

export const onRequest: PagesFunction<Env> = ({ request, env }) => handleRequest(request, env);
