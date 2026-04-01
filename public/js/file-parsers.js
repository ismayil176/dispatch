import { PDFJS_URL, PDFJS_WORKER_URL, MAMMOTH_URL } from './config.js';
import { collapseSpaces, normalizeWhitespace } from './utils.js';

let pdfjsPromise;

let mammothPromise;

async function ensureMammothLoaded() {
  if (window.mammoth) return window.mammoth;
  if (!mammothPromise) {
    mammothPromise = new Promise((resolve, reject) => {
      const existing = document.querySelector(`script[data-mammoth-loader="1"]`);
      if (existing) {
        existing.addEventListener('load', () => resolve(window.mammoth), { once: true });
        existing.addEventListener('error', () => reject(new Error('DOCX parser yüklənmədi.')), { once: true });
        return;
      }
      const script = document.createElement('script');
      script.src = MAMMOTH_URL;
      script.defer = true;
      script.dataset.mammothLoader = '1';
      script.onload = () => resolve(window.mammoth);
      script.onerror = () => reject(new Error('DOCX parser yüklənmədi.'));
      document.head.append(script);
    });
  }
  return mammothPromise;
}

async function getPdfJs() {
  if (!pdfjsPromise) {
    pdfjsPromise = import(PDFJS_URL).then((module) => {
      module.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL;
      return module;
    });
  }
  return pdfjsPromise;
}

function getExtension(name) {
  const parts = String(name ?? '').toLowerCase().split('.');
  return parts.length > 1 ? parts.pop() : '';
}

export async function extractTextFromUploadedFile(file) {
  if (!file) {
    return { text: '', parser: null, warnings: [] };
  }

  const ext = getExtension(file.name);
  const warnings = [];

  if (['txt', 'text', 'md', 'csv', 'json'].includes(ext)) {
    const text = await file.text();
    return { text: normalizeWhitespace(text), parser: ext.toUpperCase(), warnings };
  }

  if (ext === 'docx') {
    await ensureMammothLoaded();
    if (!window.mammoth) {
      throw new Error('DOCX parser yüklənmədi.');
    }
    const arrayBuffer = await file.arrayBuffer();
    const result = await window.mammoth.extractRawText({ arrayBuffer });
    if (Array.isArray(result.messages) && result.messages.length) {
      warnings.push(...result.messages.map((item) => item.message || String(item)));
    }
    return {
      text: normalizeWhitespace(result.value || ''),
      parser: 'DOCX',
      warnings,
    };
  }

  if (ext === 'pdf') {
    const pdfjsLib = await getPdfJs();
    const loadingTask = pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    const pdf = await loadingTask.promise;
    const pageTexts = [];

    for (let pageNo = 1; pageNo <= pdf.numPages; pageNo += 1) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      const lines = [];
      let lastY = null;
      let currentLine = [];

      for (const item of content.items) {
        const text = 'str' in item ? item.str : '';
        if (!text) continue;
        const y = item.transform?.[5] ?? null;
        if (lastY !== null && y !== null && Math.abs(lastY - y) > 4 && currentLine.length) {
          lines.push(currentLine.join(' '));
          currentLine = [];
        }
        currentLine.push(text);
        lastY = y;
      }
      if (currentLine.length) lines.push(currentLine.join(' '));
      pageTexts.push(lines.join('\n'));
    }

    const text = normalizeWhitespace(pageTexts.join('\n\n'));
    if (collapseSpaces(text).length < 120) {
      warnings.push('PDF daxilində çıxarılan mətn azdır. Fayl image-based/scanned ola bilər.');
    }
    return { text, parser: 'PDF', warnings };
  }

  throw new Error('Dəstəklənən formatlar: PDF, DOCX, TXT.');
}
