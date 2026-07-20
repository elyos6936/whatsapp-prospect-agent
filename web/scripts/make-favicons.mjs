import sharp from "sharp";
import pngToIco from "png-to-ico";
import { writeFileSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pub = join(__dirname, "..", "public");
const logoIcon = join(pub, "brand", "logo-icon.png");

async function squarePng(size, outPath) {
  const inset = Math.round(size * 0.72);
  const icon = await sharp(logoIcon)
    .resize(inset, inset, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toBuffer();
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: { r: 32, g: 87, b: 206, alpha: 1 },
    },
  })
    .composite([{ input: icon, gravity: "centre" }])
    .png()
    .toFile(outPath);
}

const p16 = join(pub, "_f16.png");
const p32 = join(pub, "_f32.png");
const p48 = join(pub, "favicon-48.png");
await squarePng(16, p16);
await squarePng(32, p32);
await squarePng(48, p48);
await squarePng(180, join(pub, "apple-touch-icon.png"));
await squarePng(192, join(pub, "icon-192.png"));
await squarePng(512, join(pub, "icon-512.png"));

const ico = await pngToIco([p16, p32, p48]);
writeFileSync(join(pub, "favicon.ico"), ico);
console.log("favicon.ico", ico.length);

await sharp({
  create: {
    width: 512,
    height: 512,
    channels: 3,
    background: { r: 32, g: 87, b: 206 },
  },
})
  .composite([
    {
      input: await sharp(logoIcon)
        .resize(370, 370, {
          fit: "contain",
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        })
        .png()
        .toBuffer(),
      gravity: "centre",
    },
  ])
  .jpeg({ quality: 90 })
  .toFile(join(pub, "favicon.jpeg"));
console.log("favicon.jpeg ok");

unlinkSync(p16);
unlinkSync(p32);
