import { Zap } from "lucide-react";
import styles from "./credit-icon.module.css";
export default function CreditIcon({ size = 15 }) {
  return <span className={styles.icon} aria-hidden="true"><Zap size={size} strokeWidth={1.8} /></span>;
}
