export interface FakeCall {
  url: string;
  request: Request;
  method: string;
}

export interface FakeFetch {
  impl: typeof fetch;
  calls: FakeCall[];
}

/**
 * fetch falso para os testes: cada URL registrada devolve a resposta da sua função; URL sem registro levanta
 * erro de rede (para testar o caminho de serviço fora do ar). Todas as chamadas ficam em calls.
 */
export function fakeFetch(
  responses: Record<string, (request: Request) => Response | Promise<Response>>,
): FakeFetch {
  const calls: FakeCall[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url).toString();
    calls.push({ url, request, method: request.method });
    const handler = responses[url];
    if (!handler) throw new TypeError(`fetch para ${url} falhou (sem resposta falsa)`);
    return await handler(request);
  }) as typeof fetch;
  return { impl, calls };
}
