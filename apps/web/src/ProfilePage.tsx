import type {Home, SetupStatus} from "./webTypes.js";
import { ChevronDown } from "lucide-react";
import type * as React from "react";
import { FormEvent } from "react";
import { AvatarIcon,avatarOptions } from "./AppElements.js";
import { IconPicker,MaterialIcon } from "./Icons.js";
import { getHomeId } from "./apiClient.js";
import { apiFetch } from "./i18n/apiFetch.js";
import i18n,{ localeForDates,setLocale,type Locale } from "./i18n/index.js";
import type { ApiToken,CurrentUser,UserAvatar } from "./webTypes.js";
const t = i18n.t.bind(i18n);
type ProfileLogoutProps = {
  busy: boolean;
  logout: () => Promise<void>;
};
export function ProfileLogout({ busy, logout }: ProfileLogoutProps) {
  return (
    <button
      className="secondary profile-logout"
      disabled={busy}
      onClick={logout}
    >
      {t("退出登录")}
    </button>
  );
}

type ProfileUserSettingsProps = {
  currentUser: CurrentUser | null;
  busy: boolean;
  updateAvatar: (avatar: UserAvatar) => Promise<void>;
  activeI18n: import("i18next").i18n;
  changePassword: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  passwordNotice: string;
};
export function ProfileUserSettings({
  currentUser,
  busy,
  updateAvatar,
  activeI18n,
  changePassword,
  passwordNotice,
}: ProfileUserSettingsProps) {
  return (
    <section className="panel user-info-panel">
      <div className="panel-head">
        <div>
          <h2>{t("用户信息")}</h2>
        </div>
      </div>
      <div className="user-info-body">
        <div className="user-settings-grid">
          <div className="user-identity">
            <span className="user-identity-icon">
              <AvatarIcon avatar={currentUser?.avatar} size={22} />
            </span>
            <div>
              <small>{t("用户名")}</small>
              <strong>{currentUser?.username}</strong>
            </div>
          </div>
          <div className="avatar-selection">
            <strong>{t("头像选择")}</strong>
            <div
              className="avatar-picker"
              role="radiogroup"
              aria-label={t("头像选择")}
            >
              {avatarOptions.map(({ value, label, Icon }) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={currentUser?.avatar === value}
                  className={currentUser?.avatar === value ? "selected" : ""}
                  disabled={busy}
                  onClick={() => void updateAvatar(value)}
                  title={t(label)}
                >
                  <Icon size={18} />
                  <span>{t(label)}</span>
                </button>
              ))}
            </div>
          </div>
          <label className="language-setting" htmlFor="interface-language">
            <span>{t("界面语言")}</span>
            <span className="language-select-wrap">
              <select
                id="interface-language"
                value={activeI18n.resolvedLanguage ?? activeI18n.language}
                onChange={(event) =>
                  void setLocale(event.target.value as Locale)
                }
              >
                <option value="zh-CN">{t("简体中文")}</option>
                <option value="en-US">{t("English")}</option>
              </select>
              <ChevronDown size={16} aria-hidden="true" />
            </span>
          </label>
        </div>
        <div className="password-section">
          <div>
            <strong>{t("修改密码")}</strong>
            <p className="muted">{t("验证当前密码后设置新密码")}</p>
          </div>
          <form className="password-form" onSubmit={changePassword}>
            <label>
              {t("当前密码")}
              <input
                name="currentPassword"
                type="password"
                autoComplete="current-password"
                required
              />
            </label>
            <label>
              {t("新密码")}
              <input
                name="newPassword"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            <label>
              {t("确认新密码")}
              <input
                name="confirmation"
                type="password"
                autoComplete="new-password"
                minLength={8}
                required
              />
            </label>
            <button className="primary" disabled={busy}>
              {busy ? t("修改中…") : t("修改密码")}
            </button>
          </form>
          {passwordNotice && (
            <p className="password-feedback" role="status">
              {passwordNotice}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}

type ProfileHomeSettingsProps = {
  homes: Home[];
  busy: boolean;
  setEditingHome: React.Dispatch<
    React.SetStateAction<Home | null>
  >;
  setHomeNotice: React.Dispatch<React.SetStateAction<string>>;
  setup: SetupStatus;
  updateHomeCurrency: (
    home: { id: string; name: string; icon?: string; defaultCurrency?: string },
    defaultCurrency: string,
  ) => Promise<void>;
  editingHome: Home | null;
  setBusy: React.Dispatch<React.SetStateAction<boolean>>;
  setHomes: React.Dispatch<
    React.SetStateAction<
      { id: string; name: string; icon?: string; defaultCurrency?: string }[]
    >
  >;
  setSetup: React.Dispatch<
    React.SetStateAction<SetupStatus | null>
  >;
  homeNotice: string;
};
export function ProfileHomeSettings({
  homes,
  busy,
  setEditingHome,
  setHomeNotice,
  setup,
  updateHomeCurrency,
  editingHome,
  setBusy,
  setHomes,
  setSetup,
  homeNotice,
}: ProfileHomeSettingsProps) {
  return (
    <section className="panel home-settings">
      <div className="panel-head">
        <div>
          <h2>{t("家庭管理")}</h2>
          <p className="muted">
            {t("共")}
            {homes.length} {t("个家庭 · 各家庭物资独立管理")}
          </p>
        </div>
        <button
          className="primary"
          disabled={busy}
          onClick={() => {
            setEditingHome({
              id: "",
              name: "",
              icon: "house",
              defaultCurrency: "CNY",
            });
            setHomeNotice("");
          }}
        >
          {t("新增家庭")}
        </button>
      </div>
      <div className="home-list">
        {homes.map((home) => (
          <div
            className={`home-card ${home.id === setup.home?.id ? "current" : ""}`}
            key={home.id}
          >
            <span className="home-card-icon">
              <MaterialIcon value={home.icon} home size={24} />
            </span>
            <div className="home-card-name">
              <strong>{home.name}</strong>
              <small>
                {home.id === setup.home?.id ? t("当前使用") : t("可切换")}
              </small>
            </div>
            <label className="home-card-currency">
              {t("默认币种")}
              <select
                value={home.defaultCurrency || "CNY"}
                disabled={busy}
                onChange={(event) =>
                  void updateHomeCurrency(home, event.target.value)
                }
              >
                {["CNY", "USD", "EUR", "JPY", "GBP", "HKD"].map((currency) => (
                  <option key={currency} value={currency}>
                    {currency}
                  </option>
                ))}
              </select>
            </label>
            <div className="home-card-actions">
              <button
                className="secondary"
                disabled={busy}
                onClick={() => {
                  setEditingHome(home);
                  setHomeNotice("");
                }}
              >
                {t("编辑")}
              </button>
              {home.id !== setup.home?.id && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    localStorage.setItem("al1s-wms-home-id", home.id);
                    window.location.reload();
                  }}
                >
                  {t("切换")}
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
      {editingHome && (
        <form
          className="home-editor"
          key={editingHome.id}
          onSubmit={async (event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            setBusy(true);
            setHomeNotice("");
            try {
              const response = await apiFetch(
                editingHome.id
                  ? `/api/v1/homes/${editingHome.id}`
                  : "/api/v1/homes",
                {
                  method: editingHome.id ? "PATCH" : "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    name: data.get("name"),
                    icon: data.get("icon"),
                    defaultCurrency: data.get("defaultCurrency"),
                  }),
                },
              );
              const home = await response.json();
              if (!response.ok) throw new Error(home.message || t("保存失败"));
              setHomes((previous) =>
                editingHome.id
                  ? previous.map((value) =>
                      value.id === home.id ? home : value,
                    )
                  : [...previous, home],
              );
              if (home.id === setup.home?.id) {
                setSetup({ complete: true, home });
                localStorage.setItem("al1s-wms-home-emoji", home.icon);
              }
              setEditingHome(null);
              setHomeNotice(
                editingHome.id
                  ? t("家庭已保存")
                  : t("家庭已创建，可切换后在地点页面添加房间"),
              );
            } catch (error) {
              setHomeNotice(
                error instanceof Error ? error.message : t("保存失败"),
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <h3>{editingHome.id ? t("编辑家庭") : t("新增家庭")}</h3>
          <label>
            {t("家庭名称")}
            <input
              name="name"
              required
              maxLength={80}
              defaultValue={editingHome.name}
            />
          </label>
          <label>
            {t("默认币种")}
            <select
              name="defaultCurrency"
              defaultValue={editingHome.defaultCurrency || "CNY"}
            >
              {["CNY", "USD", "EUR", "JPY", "GBP", "HKD"].map((currency) => (
                <option key={currency} value={currency}>
                  {currency}
                </option>
              ))}
            </select>
          </label>
          <IconPicker home initial={editingHome.icon} />
          <div className="home-editor-actions">
            <button className="primary" disabled={busy}>
              {busy ? t("保存中…") : t("保存家庭")}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={busy}
              onClick={() => setEditingHome(null)}
            >
              {t("取消")}
            </button>
          </div>
        </form>
      )}
      {homeNotice && (
        <p className="home-feedback" role="status">
          {homeNotice}
        </p>
      )}
    </section>
  );
}

type ProfileTokensProps = {
  barcodeNotice: string;
  createApiToken: (event: FormEvent<HTMLFormElement>) => Promise<void>;
  homes: Home[];
  newApiToken: string;
  setNewApiToken: React.Dispatch<React.SetStateAction<string>>;
  apiTokens: ApiToken[];
  revokeApiToken: (tokenId: string) => Promise<void>;
};
export function ProfileTokens({
  barcodeNotice,
  createApiToken,
  homes,
  newApiToken,
  setNewApiToken,
  apiTokens,
  revokeApiToken,
}: ProfileTokensProps) {
  return (
    <section className="panel token-panel">
      <div className="panel-head">
        <div>
          <h2>{t("MCP 访问令牌")}</h2>
          <p className="muted">
            {t(
              "连接地址为当前站点的 /mcp，认证方式为 Bearer Token。默认仅管理所选家庭。",
            )}
          </p>
        </div>
        {barcodeNotice && (
          <p className="barcode-feedback" role="status">
            {barcodeNotice}
          </p>
        )}
      </div>
      <form className="token-create" onSubmit={createApiToken}>
        <input
          name="name"
          required
          maxLength={80}
          placeholder={t("令牌名称，例如：Claude Desktop")}
        />
        <select
          name="homeId"
          defaultValue={getHomeId()}
          aria-label={t("令牌家庭范围")}
        >
          {homes.map((home) => (
            <option key={home.id} value={home.id}>
              {home.name}
            </option>
          ))}
          <option value="all">{t("全部家庭（高级）")}</option>
        </select>
        <button type="submit" className="primary">
          {t("创建令牌")}
        </button>
      </form>
      {newApiToken && (
        <div className="token-secret" role="status">
          <strong>{t("请立即复制，关闭后无法再次查看")}</strong>
          <code>{newApiToken}</code>
          <div>
            <button
              type="button"
              className="secondary"
              onClick={() => navigator.clipboard.writeText(newApiToken)}
            >
              {t("复制")}
            </button>
            <button
              type="button"
              className="text-button"
              onClick={() => setNewApiToken("")}
            >
              {t("已保存")}
            </button>
          </div>
        </div>
      )}
      <div className="token-list">
        {apiTokens.length === 0 ? (
          <p className="empty">{t("尚未创建 MCP 令牌")}</p>
        ) : (
          apiTokens.map((token) => (
            <div className="token-row" key={token.id}>
              <div>
                <strong>{token.name}</strong>
                <span>
                  {token.tokenPrefix} ·{" "}
                  {token.homeId
                    ? t("家庭：{{name}}", {
                        name: token.homeName || t("已删除"),
                      })
                    : t("全部家庭（高级）")}{" "}
                  {t("· 创建于")}
                  {new Date(token.createdAt).toLocaleString(localeForDates())}
                </span>
                <span>
                  {token.lastUsedAt
                    ? t("最近使用 {{date}}", {
                        date: new Date(token.lastUsedAt).toLocaleString(
                          localeForDates(),
                        ),
                      })
                    : t("尚未使用")}
                </span>
              </div>
              {token.revokedAt ? (
                <span className="revoked">{t("已撤销")}</span>
              ) : (
                <button
                  type="button"
                  className="danger-text"
                  onClick={() => revokeApiToken(token.id)}
                >
                  {t("撤销")}
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </section>
  );
}
