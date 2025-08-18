import fs from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { processFile } from '../../utils/file-processing';

describe('Binary File Detection', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(tmpdir(), 'pasteflow-binary-test-'));
  });

  afterEach(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should detect binary files by extension', async () => {
    const imagePath = path.join(tempDir, 'test.png');
    fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4E, 0x47])); // PNG header

    const result = await processFile(imagePath, tempDir);

    expect(result.isBinary).toBe(true);
    expect(result.content).toBe('');
    expect(result.tokenCount).toBe(0);
    expect(result.fileType).toBe('PNG');
  });

  it('should detect text files as non-binary', async () => {
    const textPath = path.join(tempDir, 'test.txt');
    const content = 'This is a normal text file';
    fs.writeFileSync(textPath, content, 'utf8');

    const result = await processFile(textPath, tempDir);

    expect(result.isBinary).toBe(false);
    expect(result.isSkipped).toBe(false);
    expect(result.fileType).toBe('TXT');
    expect(result.isContentLoaded).toBe(false);
  });

  it('should detect binary content in text extension files', async () => {
    const textPath = path.join(tempDir, 'fake.txt');
    const binaryContent = Buffer.from(Array(100).fill(0)).toString();
    fs.writeFileSync(textPath, binaryContent);

    const result = await processFile(textPath, tempDir);

    expect(result.isBinary).toBe(true);
    expect(result.content).toBe('');
    expect(result.fileType).toBe('BINARY');
    expect(result.isSkipped).toBe(false);
  });

  it('should handle special token sequences correctly', async () => {
    const textPath = path.join(tempDir, 'special.txt');
    // Use a special token pattern without explicitly naming it
    const specialContent = 'Normal text <|special|> more text';
    fs.writeFileSync(textPath, specialContent);

    const result = await processFile(textPath, tempDir);

    // Special tokens should NOT be treated as binary
    // They are handled during token sanitization instead
    expect(result.isBinary).toBe(false);
    expect(result.content).toBe(specialContent);
    expect(result.fileType).toBe('TEXT');
    expect(result.isSkipped).toBe(false);
  });

  it('should preserve JavaScript files with binary-like patterns', async () => {
    const jsPath = path.join(tempDir, 'test.js');
    const jsContent = 'const data = "\\u0000\\u0001\\u0002"; // Binary data in JS';
    fs.writeFileSync(jsPath, jsContent);

    const result = await processFile(jsPath, tempDir);

    expect(result.isBinary).toBe(false);
    expect(result.fileType).toBe('JS');
    expect(result.isSkipped).toBe(false);
    expect(result.isContentLoaded).toBe(false);
  });

  it('should handle multiple binary file types correctly', async () => {
    const testFiles = [
      { name: 'image.jpg', expectedType: 'JPG' },
      { name: 'video.mp4', expectedType: 'MP4' },
      { name: 'archive.zip', expectedType: 'ZIP' },
      { name: 'doc.pdf', expectedType: 'PDF' },
      { name: 'font.woff2', expectedType: 'WOFF2' }
    ];

    const results = await Promise.all(
      testFiles.map(async ({ name, expectedType }) => {
        const filePath = path.join(tempDir, name);
        fs.writeFileSync(filePath, Buffer.from([0x00, 0x01, 0x02, 0x03]));
        
        const result = await processFile(filePath, tempDir);
        
        return {
          name,
          isBinary: result.isBinary,
          fileType: result.fileType,
          expectedType
        };
      })
    );

    results.forEach(({ isBinary, fileType, expectedType }) => {
      expect(isBinary).toBe(true);
      expect(fileType).toBe(expectedType);
    });
    expect(results).toHaveLength(5);
    expect(results.every(r => r.isBinary)).toBe(true);
  });
});