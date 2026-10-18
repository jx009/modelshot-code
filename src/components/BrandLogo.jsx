import styles from "./BrandLogo.module.css";

// Geometry follows the supplied 176 × 160 mark, without the presentation card's padding.
export function BrandMark({ size = 32 }) {
  return <svg className={styles.mark} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 176 160" width={size} height={size * 160 / 176} fill="currentColor" aria-hidden="true" focusable="false">
    <rect width="65.4884" height="36.8372" rx="10.2326" />
    <rect x="77.767" width="36.8372" height="36.8372" rx="10.2326" fill="#FF5C1A" />
    <rect y="61.395" width="126.8837" height="36.8372" rx="10.2326" />
    <rect y="122.791" width="176" height="36.8372" rx="10.2326" />
  </svg>;
}

export default function BrandLogo() {
  return <><BrandMark /><span className={styles.wordmark}>来塔AI<small>letaidraw</small></span></>;
}
