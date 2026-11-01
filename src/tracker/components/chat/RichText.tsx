import { Fragment, type ReactNode } from 'react';

/**
 * Tiny, safe formatter for assistant replies: paragraphs, bullet/numbered lists, fenced code,
 * **bold**, *italic* and `inline code`. It builds React nodes — never raw HTML — so message text
 * can't inject markup.
 */
function inline(text: string, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const idx = m.index ?? 0;
    if (idx > last) out.push(text.slice(last, idx));
    const tok = m[0];
    const k = `${keyBase}-${i++}`;
    if (tok.startsWith('`')) out.push(<code key={k} className="rounded bg-sunken px-1.5 py-0.5 font-mono text-[0.88em]">{tok.slice(1, -1)}</code>);
    else if (tok.startsWith('**')) out.push(<strong key={k} className="font-semibold">{tok.slice(2, -2)}</strong>);
    else out.push(<em key={k}>{tok.slice(1, -1)}</em>);
    last = idx + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

type Block = { type: 'p'; text: string } | { type: 'ul' | 'ol'; items: string[] } | { type: 'code'; text: string };

function parse(src: string): Block[] {
  const blocks: Block[] = [];
  const lines = src.replace(/\r\n/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.startsWith('```')) {
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) body.push(lines[i++]!);
      i++;
      blocks.push({ type: 'code', text: body.join('\n') });
    } else if (/^\s*[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*[-*•]\s+/, ''));
      blocks.push({ type: 'ul', items });
    } else if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i]!)) items.push(lines[i++]!.replace(/^\s*\d+[.)]\s+/, ''));
      blocks.push({ type: 'ol', items });
    } else if (line.trim() === '') {
      i++;
    } else {
      const para: string[] = [];
      while (i < lines.length && lines[i]!.trim() !== '' && !lines[i]!.startsWith('```') && !/^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!)) para.push(lines[i++]!);
      blocks.push({ type: 'p', text: para.join('\n') });
    }
  }
  return blocks;
}

export function RichText({ text }: { text: string }) {
  const blocks = parse(text);
  return (
    <div className="space-y-3 break-words">
      {blocks.map((b, bi) => {
        const key = `b${bi}`;
        switch (b.type) {
          case 'code':
            return (
              <pre key={key} className="scroll-thin overflow-x-auto rounded-lg border border-line bg-sunken p-3 font-mono text-[13px] leading-relaxed">
                <code>{b.text}</code>
              </pre>
            );
          case 'ul':
            return (
              <ul key={key} className="list-disc space-y-1 pl-5 marker:text-ink-3">
                {b.items.map((it, ii) => (
                  <li key={ii}>{inline(it, `${key}-${ii}`)}</li>
                ))}
              </ul>
            );
          case 'ol':
            return (
              <ol key={key} className="list-decimal space-y-1 pl-5 marker:text-ink-3">
                {b.items.map((it, ii) => (
                  <li key={ii}>{inline(it, `${key}-${ii}`)}</li>
                ))}
              </ol>
            );
          default:
            return (
              <p key={key}>
                {b.text.split('\n').map((ln, li, arr) => (
                  <Fragment key={li}>
                    {inline(ln, `${key}-${li}`)}
                    {li < arr.length - 1 && <br />}
                  </Fragment>
                ))}
              </p>
            );
        }
      })}
    </div>
  );
}
