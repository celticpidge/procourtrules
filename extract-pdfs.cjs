const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');
const { PDFParse } = require('pdf-parse');

const rootDir = __dirname;
const sourcesDir = join(rootDir, 'pdf-sources');
const outputDir = join(rootDir, 'src', 'data');

const sources = [
  {
    file: 'pnw-league-regulations-august-2025.pdf',
    id: 'pnw-league-regs',
    name: 'PNW League Regulations',
    priority: 1,
    description: 'USTA Pacific Northwest Section league-specific regulations. Overrides national rules when applicable.',
  },
  {
    file: '2026 USTA.pdf',
    id: 'usta-league-regs',
    name: 'USTA League Regulations (National)',
    priority: 2,
    description: 'National USTA league regulations. Apply unless overridden by PNW local regulations.',
  },
  {
    file: '2015_Code.pdf',
    id: 'the-code',
    name: 'The Code (Unofficiated Matches)',
    priority: 3,
    description: 'USTA guidelines for player conduct and fair play in unofficiated matches.',
  },
  {
    file: 'friend-at-court.pdf',
    id: 'friend-at-court',
    name: 'Friend at Court',
    priority: 4,
    description: 'USTA handbook of rules and regulations including The Code and officiating procedures.',
  },
  {
    file: '2026-rules-of-tennis-english.pdf',
    id: 'itf-rules',
    name: 'ITF Rules of Tennis (2026)',
    priority: 5,
    description: 'International Tennis Federation official rules of tennis. Base rules that apply unless overridden by USTA or PNW regulations.',
  },
];

async function extractPdf(filePath) {
  const buffer = new Uint8Array(readFileSync(filePath));
  const parser = new PDFParse(buffer);
  await parser.load();
  const result = await parser.getText();
  // result.pages is an array of { text } objects
  return result.pages.map(p => p.text).join('\n\n');
}

async function main() {
  console.log('Extracting text from PDFs...\n');

  for (const source of sources) {
    const filePath = join(sourcesDir, source.file);
    console.log(`Processing: ${source.file}`);

    try {
      const text = await extractPdf(filePath);
      const output = {
        id: source.id,
        name: source.name,
        priority: source.priority,
        description: source.description,
        content: text,
      };

      const outputPath = join(outputDir, `${source.id}.json`);
      writeFileSync(outputPath, JSON.stringify(output, null, 2));

      const wordCount = text.split(/\s+/).length;
      console.log(`  ✓ ${wordCount} words → ${source.id}.json`);
    } catch (err) {
      console.error(`  ✗ Error: ${err.message}`);
    }
  }

  console.log('\nDone! Check src/data/ for output files.');
}

main();
