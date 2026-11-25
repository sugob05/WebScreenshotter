// TIFF 6.0, little-endian, single uncompressed RGBA strip, unassociated alpha.
// All offsets are explicit; no native image library or format converter is used.
export function encodeTiff(rgba, width, height) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    rgba.length !== width * height * 4
  )
    throw new Error('Ungültige RGBA-Bilddaten.');
  const tagCount = 15;
  const bitsOffset = 8 + 2 + tagCount * 12 + 4;
  const resolutionOffset = bitsOffset + 8;
  const pixelsOffset = resolutionOffset + 16;
  const output = Buffer.alloc(pixelsOffset + rgba.length);
  output.write('II', 0, 'ascii');
  output.writeUInt16LE(42, 2);
  output.writeUInt32LE(8, 4);
  output.writeUInt16LE(tagCount, 8);
  const tags = [
    [256, 4, 1, width],
    [257, 4, 1, height],
    [258, 3, 4, bitsOffset],
    [259, 3, 1, 1],
    [262, 3, 1, 2],
    [273, 4, 1, pixelsOffset],
    [274, 3, 1, 1],
    [277, 3, 1, 4],
    [278, 4, 1, height],
    [279, 4, 1, rgba.length],
    [282, 5, 1, resolutionOffset],
    [283, 5, 1, resolutionOffset + 8],
    [284, 3, 1, 1],
    [296, 3, 1, 2],
    [338, 3, 1, 2],
  ];
  tags.forEach(([tag, type, count, value], index) => {
    const offset = 10 + index * 12;
    output.writeUInt16LE(tag, offset);
    output.writeUInt16LE(type, offset + 2);
    output.writeUInt32LE(count, offset + 4);
    if (type === 3 && count === 1) output.writeUInt16LE(value, offset + 8);
    else output.writeUInt32LE(value, offset + 8);
  });
  for (let index = 0; index < 4; index++) output.writeUInt16LE(8, bitsOffset + index * 2);
  output.writeUInt32LE(96, resolutionOffset);
  output.writeUInt32LE(1, resolutionOffset + 4);
  output.writeUInt32LE(96, resolutionOffset + 8);
  output.writeUInt32LE(1, resolutionOffset + 12);
  Buffer.from(rgba).copy(output, pixelsOffset);
  return output;
}
