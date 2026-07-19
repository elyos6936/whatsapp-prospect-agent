import sharp from "sharp";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webRoot = join(__dirname, "..");
const pub = join(webRoot, "public");
const brand = join(pub, "brand");
const srcOg = join(
  process.env.USERPROFILE || "",
  ".cursor",
  "projects",
  "c-Projets-whatsapp-prospect-agent",
  "assets",
  "og-banner-source.png",
);
const logoSquare = join(brand, "logo.png");
const logoIcon = join(brand, "logo-icon.png");

await sharp(srcOg)
  .resize(1200, 630, { fit: "cover", position: "centre" })
  .jpeg({ quality: 82, mozjpeg: true })
  .toFile(join(brand, "og-banner.jpg"));
console.log("og-banner.jpg ok");

async function brandIcon(size, out) {
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
    .toFile(join(pub, out));
  console.log(out, "ok");
}

await brandIcon(48, "favicon-48.png");
await brandIcon(180, "apple-touch-icon.png");
await brandIcon(192, "icon-192.png");
await brandIcon(512, "icon-512.png");

// Keep Organization logo as the square brand mark (already in brand/logo.png)
void logoSquare;
