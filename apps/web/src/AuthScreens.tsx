import { useState,type FormEvent } from "react";
import { BrandWordmark } from "./AppElements.js";
import { apiFetch } from "./i18n/apiFetch.js";
import i18n from "./i18n/index.js";
import { IconPicker } from "./Icons.js";
const t=i18n.t.bind(i18n);
export function Setup({
  onComplete,
}: {
  onComplete: (home: { id: string; name: string; icon: string }) => void;
}) {
  const [step, setStep] = useState(1);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [homeName, setHomeName] = useState("");
  const [homeEmoji, setHomeEmoji] = useState("house");
  const [currency, setCurrency] = useState("CNY");
  const [locations, setLocations] = useState(["储物间", "厨房"]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [page, setPage] = useState(1);
  const canNext =
    step === 1
      ? username.trim().length >= 2 && password.length >= 8
      : step === 2
        ? homeName.trim().length > 0
        : locations.some((name) => name.trim());
  const submit = async () => {
    if (!canNext) return;
    if (step < 3) {
      setStep(step + 1);
      return;
    }
    setBusy(true);
    setError("");
    const response = await apiFetch("/api/v1/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username,
        password,
        homeName,
        homeIcon: homeEmoji,
        currency,
        locations,
      }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(data.message ?? t("初始化失败，请检查输入"));
      return;
    }
    localStorage.setItem("al1s-wms-home-id", data.home.id);
    localStorage.setItem("al1s-wms-home-emoji", homeEmoji);
    onComplete(data.home);
  };
  return (
    <div className="setup-shell">
      <div className="setup-card">
        <div className="setup-brand">
          <img className="setup-mascot" src="/alice.gif" alt="Alice" />
          <div>
            <BrandWordmark />
            <span>{t("首次启动设置")}</span>
          </div>
        </div>
        <div className="setup-progress">
          <span className={step >= 1 ? "active" : ""}>{t("1 账号")}</span>
          <i />
          <span className={step >= 2 ? "active" : ""}>{t("2 家庭")}</span>
          <i />
          <span className={step >= 3 ? "active" : ""}>{t("3 地点")}</span>
        </div>
        {step === 1 && (
          <div className="setup-step">
            <p className="eyebrow">{t("建立本地管理员")}</p>
            <h1>{t("先创建你的账号")}</h1>
            <p className="muted">
              {t("账号只保存在这台 AL1S WMS 中，用于管理成员和敏感操作。")}
            </p>
            <label>
              {t("用户名")}
              <input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                autoFocus
              />
            </label>
            <label>
              {t("密码")}
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
              />
            </label>
          </div>
        )}
        {step === 2 && (
          <div className="setup-step">
            <p className="eyebrow">{t("建立你的 Home")}</p>
            <h1>{t("这个家庭怎么称呼？")}</h1>
            <p className="muted">
              {t("Home 是物资、成员、地点和预算的共同边界。")}
            </p>
            <label>
              {t("家庭名称")}
              <input
                value={homeName}
                onChange={(event) => setHomeName(event.target.value)}
                placeholder={t("例如：我们家")}
                autoFocus
              />
            </label>
            <IconPicker home initial={homeEmoji} onChange={setHomeEmoji} />
            <label>
              {t("默认货币")}
              <select
                value={currency}
                onChange={(event) => setCurrency(event.target.value)}
              >
                <option value="CNY">{t("人民币（CNY）")}</option>
                <option value="USD">{t("美元（USD）")}</option>
              </select>
            </label>
          </div>
        )}
        {step === 3 && (
          <div className="setup-step">
            <p className="eyebrow">{t("整理空间")}</p>
            <h1>{t("先添加几个存放地点")}</h1>
            <p className="muted">
              {t("之后可以继续增加。地点帮助你知道物资放在哪里。")}
            </p>
            <div className="location-inputs">
              {locations.map((name, index) => (
                <div className="location-input" key={index}>
                  <input
                    value={name}
                    onChange={(event) =>
                      setLocations(
                        locations.map((value, i) =>
                          i === index ? event.target.value : value,
                        ),
                      )
                    }
                    placeholder={t("例如：储物间")}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setLocations(locations.filter((_, i) => i !== index))
                    }
                    aria-label={t("删除地点")}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
            <button
              className="add-location"
              type="button"
              onClick={() => setLocations([...locations, ""])}
            >
              {t("＋ 添加另一个地点")}
            </button>
          </div>
        )}
        {error && <div className="setup-error">{error}</div>}
        <div className="setup-footer">
          {step > 1 ? (
            <button className="secondary" onClick={() => setStep(step - 1)}>
              {t("上一步")}
            </button>
          ) : (
            <span />
          )}
          <button
            className="primary"
            disabled={!canNext || busy}
            onClick={submit}
          >
            {busy
              ? t("创建中…")
              : step === 3
                ? t("完成设置，进入 Dashboard")
                : t("继续")}
          </button>
        </div>
      </div>
    </div>
  );
}

export function Login({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    const response = await apiFetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await response.json();
    setBusy(false);
    if (!response.ok) {
      setError(data.message ?? t("登录失败"));
      return;
    }
    onLogin();
  };
  return (
    <div className="setup-shell">
      <form className="setup-card login-card" onSubmit={submit}>
        <div className="setup-brand">
          <img className="setup-mascot" src="/alice.gif" alt="Alice" />
          <div>
            <BrandWordmark />
          </div>
        </div>
        <div className="setup-step">
          <p className="eyebrow">{t("欢迎回来")}</p>
          <h1>{t("登录")}</h1>
          <p className="muted">{t("使用初始化时创建的管理员账号继续。")}</p>
          <label>
            {t("用户名")}
            <input
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoFocus
            />
          </label>
          <label>
            {t("密码")}
            <input
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
            />
          </label>
        </div>
        {error && <div className="setup-error">{error}</div>}
        <button className="primary full" disabled={busy}>
          {busy ? t("登录中…") : t("登录")}
        </button>
      </form>
    </div>
  );
}
