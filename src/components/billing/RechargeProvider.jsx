"use client";
import { createContext, useCallback, useContext, useState } from "react";
import { useLocale } from "next-intl";
import Modal from "@/components/ui/Modal";
import RechargePanel from "./RechargePanel";
import styles from "./recharge.module.css";
const RechargeContext = createContext(null);
export function useRecharge() { return useContext(RechargeContext); }
export function RechargeProvider({ children }) {
  const [opened, setOpened] = useState(false);
  const locale = useLocale();
  const open = useCallback(() => setOpened(true), []);
  const close = useCallback(() => setOpened(false), []);
  return <RechargeContext.Provider value={{ open, close }}>{children}{opened && <Modal onClose={close} label={locale === "zh" ? "积分充值" : "Buy credits"} className={styles.dialog}><RechargePanel onClose={close} /></Modal>}</RechargeContext.Provider>;
}
