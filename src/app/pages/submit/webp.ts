/** Limite do catálogo: capa em WebP de até 300 KB (o mesmo valor do rules.mjs de lá). */
export const MAX_COVER_BYTES = 300 * 1024;

const LARGURA_MAXIMA = 1280;
const LARGURA_MINIMA = 160;

/**
 * Converte a imagem escolhida para WebP no navegador, reduzindo qualidade e depois tamanho até caber no limite.
 * Devolve os bytes em base64 puro (sem prefixo data:), pronto para o POST da submissão.
 */
export async function converterParaWebp(file: File, maxBytes = MAX_COVER_BYTES): Promise<string> {
  if (typeof createImageBitmap === 'undefined') {
    throw new Error('Este navegador não consegue converter imagens. Atualize-o para enviar a capa.');
  }
  const bitmap = await createImageBitmap(file);
  try {
    for (
      let largura = Math.min(bitmap.width, LARGURA_MAXIMA);
      largura >= LARGURA_MINIMA;
      largura = Math.round(largura * 0.75)
    ) {
      const altura = Math.max(1, Math.round(largura * (bitmap.height / bitmap.width)));
      for (const qualidade of [0.9, 0.7, 0.5, 0.3]) {
        const base64 = await renderizar(bitmap, largura, altura, qualidade);
        if (atob(base64).length <= maxBytes) return base64;
      }
    }
    throw new Error(
      'A imagem não coube nos 300 KB nem com muita compressão. Tente uma imagem menor.',
    );
  } finally {
    bitmap.close();
  }
}

async function renderizar(
  bitmap: ImageBitmap,
  largura: number,
  altura: number,
  qualidade: number,
): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = largura;
  canvas.height = altura;
  const contexto = canvas.getContext('2d');
  if (!contexto) {
    throw new Error('Este navegador não consegue converter imagens. Atualize-o para enviar a capa.');
  }
  contexto.drawImage(bitmap, 0, 0, largura, altura);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, 'image/webp', qualidade),
  );
  if (!blob) throw new Error('Este navegador não consegue gerar WebP. Tente outro navegador.');
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error('Não consegui ler a imagem convertida.'));
    reader.readAsDataURL(blob);
  });
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}
