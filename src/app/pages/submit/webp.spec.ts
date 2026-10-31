import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { converterParaWebp, MAX_COVER_BYTES } from './webp';

const PNG_FAKE = new File([new Uint8Array(8)], 'capa.png', { type: 'image/png' });

/**
 * O jsdom não tem canvas nem createImageBitmap: tudo aqui é mockado no protótipo para exercitar a lógica de
 * qualidade/escala sem depender de renderização de verdade.
 */
function stubCanvas(tamanhos: number[]) {
  let chamadas = 0;
  const qualidades: number[] = [];
  const toBlob = vi.fn(
    (cb: (b: Blob | null) => void, _tipo: string, qualidade = 0) => {
      const tamanho = tamanhos[Math.min(chamadas, tamanhos.length - 1)];
      chamadas++;
      qualidades.push(qualidade);
      cb(new Blob([new Uint8Array(tamanho)], { type: 'image/webp' }));
    },
  );
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => ({ width: 1920, height: 1080, close: () => {} })),
  );
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({
    drawImage: () => {},
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(toBlob as never);
  return { toBlob, qualidades };
}

describe('conversão da capa para WebP', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('converte e devolve base64 sem o prefixo data:', async () => {
    stubCanvas([100]);
    const base64 = await converterParaWebp(PNG_FAKE);
    expect(base64).not.toContain('data:');
    expect(atob(base64)).toHaveLength(100);
  });

  it('reduz a qualidade até o base64 caber no limite', async () => {
    const { qualidades } = stubCanvas([MAX_COVER_BYTES + 1, 50]);
    const base64 = await converterParaWebp(PNG_FAKE);
    expect(atob(base64)).toHaveLength(50);
    // Duas tentativas: 0.9 estourou, 0.7 coube.
    expect(qualidades).toEqual([0.9, 0.7]);
  });

  it('quando nenhuma qualidade coube, reduz a largura e tenta de novo', async () => {
    // Quatro qualidades da primeira escala estouram; na escala reduzida, a primeira qualidade já cabe.
    const { qualidades } = stubCanvas([
      MAX_COVER_BYTES + 1,
      MAX_COVER_BYTES + 1,
      MAX_COVER_BYTES + 1,
      MAX_COVER_BYTES + 1,
      80,
    ]);
    const base64 = await converterParaWebp(PNG_FAKE);
    expect(atob(base64)).toHaveLength(80);
    expect(qualidades).toEqual([0.9, 0.7, 0.5, 0.3, 0.9]);
  });

  it('imagem que não cabe nem com tudo dá erro claro', async () => {
    stubCanvas([MAX_COVER_BYTES + 1]);
    await expect(converterParaWebp(PNG_FAKE)).rejects.toThrow('não coube');
  });

  it('sem createImageBitmap (navegador velho), erro claro', async () => {
    stubCanvas([100]);
    // Simular navegador sem a API: undefined passa pelo mesmo typeof que o código usa.
    vi.stubGlobal('createImageBitmap', undefined);
    await expect(converterParaWebp(PNG_FAKE)).rejects.toThrow('não consegue converter');
  });

  it('canvas sem contexto 2d dá erro claro', async () => {
    stubCanvas([100]);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null as never);
    await expect(converterParaWebp(PNG_FAKE)).rejects.toThrow('não consegue converter');
  });
});
