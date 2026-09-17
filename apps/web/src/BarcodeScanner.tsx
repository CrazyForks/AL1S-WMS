import { useEffect, useRef, useState } from "react";
import i18n from "./i18n/index.js";
const t = i18n.t.bind(i18n);
import type { IScannerControls } from "@zxing/browser";
import { X } from "lucide-react";

export function BarcodeScanner({
  onScan,
  onClose,
}: {
  onScan: (barcode: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let controls: IScannerControls | undefined,
      closed = false;
    void import("@zxing/browser")
      .then(({ BrowserMultiFormatReader }) => {
        if (closed || !videoRef.current) return;
        const reader = new BrowserMultiFormatReader();
        return reader.decodeFromConstraints(
          { audio: false, video: { facingMode: { ideal: "environment" } } },
          videoRef.current,
          (result) => {
            if (!result || closed) return;
            closed = true;
            controls?.stop();
            onScan(result.getText());
          },
        );
      })
      .then((value) => {
        controls = value;
        if (closed) value?.stop();
      })
      .catch((reason) => {
        if (!closed)
          setError(
            reason instanceof Error ? reason.message : t("无法打开摄像头"),
          );
      });
    return () => {
      closed = true;
      controls?.stop();
    };
  }, [onScan]);
  return (
    <div className="modal-backdrop">
      <section
        className="modal barcode-scanner"
        role="dialog"
        aria-modal="true"
        aria-labelledby="scanner-title"
      >
        <div className="modal-head">
          <div>
            <h2 id="scanner-title">{t("扫描商品条码")}</h2>
            <p className="muted">{t("将条码放入取景框内")}</p>
          </div>
          <button
            type="button"
            className="close"
            aria-label={t("关闭")}
            onClick={onClose}
          >
            <X size={18} />
          </button>
        </div>
        <div className="scanner-viewport">
          <video ref={videoRef} muted playsInline />
          <span aria-hidden="true" />
        </div>
        {error && (
          <p className="setup-error" role="alert">
            {t("摄像头不可用：")}
            {error}
            {t("。请返回手动输入条码。")}
          </p>
        )}
      </section>
    </div>
  );
}
