import { createHash } from 'node:crypto';

export const COVER_ORIGIN = 'https://sebola3461.github.io';

// Endereços que o widget Turnstile (anti-robô) usa, como a documentação do Cloudflare pede para sites com CSP.
// A verificação do token acontece no servidor (Functions), então connect-src não precisa do domínio deles.
export const TURNSTILE = {
  script: 'https://challenges.cloudflare.com/turnstile/v0/api.js',
  frame: 'https://challenges.cloudflare.com',
};

const SCRIPT_TAG = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;

// "JavaScript MIME type essence match" do HTML Living Standard: com um destes tipos, o navegador executa o script.
const JS_MIME_TYPES = new Set([
  'application/ecmascript',
  'application/javascript',
  'application/x-ecmascript',
  'application/x-javascript',
  'text/ecmascript',
  'text/javascript',
  'text/javascript1.0',
  'text/javascript1.1',
  'text/javascript1.2',
  'text/javascript1.3',
  'text/javascript1.4',
  'text/javascript1.5',
  'text/jscript',
  'text/livescript',
  'text/x-ecmascript',
  'text/x-javascript',
]);

/** Valor de um atributo; o nome precisa vir depois de espaço, para data-type não passar por type. */
function attributeValue(attributes, name) {
  const match = new RegExp(
    `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,
    'i',
  ).exec(attributes);
  return match ? (match[1] ?? match[2] ?? match[3]) : null;
}

function isExecutable(attributes) {
  if (attributeValue(attributes, 'src') !== null) return false;
  const type = attributeValue(attributes, 'type');
  if (type === null || type.trim() === '') return true;
  const essence = type.split(';')[0].trim().toLowerCase();
  return essence === 'module' || JS_MIME_TYPES.has(essence);
}

/**
 * Hashes dos scripts inline executáveis de uma página. O Angular gera alguns no pré-render (o contrato de eventos
 * da hidratação, por exemplo); scripts com src e blocos de dados (application/json) não entram.
 */
export function inlineScriptHashes(html) {
  const hashes = [];
  for (const [, attributes, body] of html.matchAll(SCRIPT_TAG)) {
    if (!isExecutable(attributes)) continue;
    hashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  return hashes;
}

/**
 * Conteúdo do _headers do Cloudflare Pages. style-src aceita inline porque o pré-render do Angular põe os estilos
 * dos componentes em <style>; script-src só aceita os scripts do próprio site e os inline conhecidos pelo hash.
 */
export function buildHeaders(scriptHashes) {
  const scripts = ["'self'", ...[...new Set(scriptHashes)].sort(), TURNSTILE.script].join(' ');
  const csp = [
    "default-src 'self'",
    `script-src ${scripts}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${COVER_ORIGIN}`,
    `frame-src ${TURNSTILE.frame}`,
    "connect-src 'self'",
    "font-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
  return [
    '/*',
    `  Content-Security-Policy: ${csp}`,
    '  X-Content-Type-Options: nosniff',
    '  Referrer-Policy: strict-origin-when-cross-origin',
    '  Permissions-Policy: camera=(), microphone=(), geolocation=()',
    '  Strict-Transport-Security: max-age=31536000',
    '',
  ].join('\n');
}
