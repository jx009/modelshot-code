import Image from "next/image";

export default function AssetImage({ src, alt, ...props }) {
  if (!src) return null;
  // Authenticated images must be fetched by the browser with its session cookie.
  return <Image src={src} alt={alt} width={1200} height={1600} unoptimized {...props} />;
}
