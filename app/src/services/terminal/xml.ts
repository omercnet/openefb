// A small, forgiving-nowhere SAX tokenizer for the d-TPP metafile (about 16 MB of simple, flat XML). Platform-free.
// Supports elements, attributes, text, CDATA, comments, processing instructions and the DOCTYPE line. Does not expand
// custom entities (so there is no entity-expansion attack surface); the five XML entities and numeric references are
// decoded. Anything malformed (unterminated tag, mismatched or unclosed element, no root) throws XmlError.
export class XmlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'XmlError';
  }
}

export interface XmlHandler {
  start(name: string, attributes: Record<string, string>): void;
  text(text: string): void;
  end(name: string): void;
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z]+);/g, (whole, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return Object.prototype.hasOwnProperty.call(ENTITIES, body) ? ENTITIES[body] : whole;
  });
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = Object.create(null) as Record<string, string>;
  const re = /([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/y;
  let i = 0;
  while (i < source.length) {
    while (i < source.length && /\s/.test(source[i])) i++;
    if (i >= source.length) break;
    re.lastIndex = i;
    const m = re.exec(source);
    if (!m) throw new XmlError(`bad attribute near "${source.slice(i, i + 20)}"`);
    attributes[m[1]] = decodeEntities(m[3] ?? m[4] ?? '');
    i = re.lastIndex;
  }
  return attributes;
}

export function parseXml(xml: string, handler: XmlHandler): void {
  const stack: string[] = [];
  let sawRoot = false;
  let i = 0;
  const n = xml.length;
  while (i < n) {
    const lt = xml.indexOf('<', i);
    if (lt < 0) {
      if (xml.slice(i).trim() !== '') throw new XmlError('text after the root element');
      break;
    }
    if (lt > i) {
      const text = xml.slice(i, lt);
      if (stack.length > 0) handler.text(decodeEntities(text));
      else if (text.trim() !== '') throw new XmlError('text outside the root element');
    }
    if (xml.startsWith('<!--', lt)) {
      const end = xml.indexOf('-->', lt + 4);
      if (end < 0) throw new XmlError('unterminated comment');
      i = end + 3;
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const end = xml.indexOf(']]>', lt + 9);
      if (end < 0) throw new XmlError('unterminated CDATA');
      if (stack.length > 0) handler.text(xml.slice(lt + 9, end));
      i = end + 3;
    } else if (xml.startsWith('<?', lt)) {
      const end = xml.indexOf('?>', lt + 2);
      if (end < 0) throw new XmlError('unterminated processing instruction');
      i = end + 2;
    } else if (xml.startsWith('<!', lt)) {
      const end = xml.indexOf('>', lt + 2);
      if (end < 0) throw new XmlError('unterminated declaration');
      i = end + 1;
    } else if (xml.startsWith('</', lt)) {
      const end = xml.indexOf('>', lt + 2);
      if (end < 0) throw new XmlError('unterminated end tag');
      const name = xml.slice(lt + 2, end).trim();
      const open = stack.pop();
      if (open !== name) throw new XmlError(`mismatched end tag </${name}>`);
      handler.end(name);
      i = end + 1;
    } else {
      // Start tag: find the closing '>' outside quoted attribute values.
      let j = lt + 1;
      let quote = '';
      while (j < n) {
        const c = xml[j];
        if (quote) {
          if (c === quote) quote = '';
        } else if (c === '"' || c === "'") quote = c;
        else if (c === '>') break;
        j++;
      }
      if (j >= n) throw new XmlError('unterminated start tag');
      let inside = xml.slice(lt + 1, j);
      const selfClosing = inside.endsWith('/');
      if (selfClosing) inside = inside.slice(0, -1);
      const nameMatch = /^[^\s/>]+/.exec(inside);
      if (!nameMatch) throw new XmlError('start tag without a name');
      const name = nameMatch[0];
      if (stack.length === 0) {
        if (sawRoot) throw new XmlError('more than one root element');
        sawRoot = true;
      }
      handler.start(name, parseAttributes(inside.slice(name.length)));
      if (selfClosing) handler.end(name);
      else stack.push(name);
      i = j + 1;
    }
  }
  if (!sawRoot) throw new XmlError('no root element');
  if (stack.length > 0) throw new XmlError(`unclosed element <${stack[stack.length - 1]}>`);
}
