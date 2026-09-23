import {createHash,randomUUID,scryptSync,timingSafeEqual} from "node:crypto";
import type {DatabaseSync} from "node:sqlite";
import type {FastifyReply,FastifyRequest} from "fastify";

export function createAuth(db:DatabaseSync) {
function setSession(reply: FastifyReply, userId: string) {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)",
  ).run(id, userId, new Date(Date.now() + 30 * 86400000).toISOString());
  reply.header(
    "set-cookie",
    `session=${id}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`,
  );
}
function passwordMatches(password:string,passwordHash:string) {
  const [salt,expected]=passwordHash.split(":");
  if(!salt||!expected)return false;
  const actual=scryptSync(password,salt,64).toString("hex");
  return actual.length===expected.length&&timingSafeEqual(Buffer.from(actual),Buffer.from(expected));
}
function sessionUser(request: FastifyRequest) {
  const cookie = request.headers.cookie
    ?.split(";")
    .map((part: string) => part.trim())
    .find((part: string) => part.startsWith("session="));
  const id = cookie?.slice(8);
  if (!id) return undefined;
  return db
    .prepare(
      "SELECT users.id, users.username, users.role, users.avatar FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.id = ? AND sessions.expires_at > ?",
    )
    .get(id, new Date().toISOString());
}
function tokenUser(request: FastifyRequest) {
  const authorization = request.headers.authorization;
  if (typeof authorization !== "string" || !authorization.startsWith("Bearer "))
    return undefined;
  const token = authorization.slice(7).trim();
  if (!token.startsWith("al1s_") || token.length < 30) return undefined;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const row = db
    .prepare(
      "SELECT api_tokens.id, api_tokens.home_id AS homeId, users.id AS userId, users.username, users.role FROM api_tokens JOIN users ON users.id = api_tokens.user_id WHERE api_tokens.token_hash = ? AND api_tokens.revoked_at IS NULL",
    )
    .get(tokenHash) as
    | { id: string; homeId: string | null; userId: string; username: string; role: string }
    | undefined;
  if (row)
    db.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(
      new Date().toISOString(),
      row.id,
    );
  return row;
}
  return {setSession,passwordMatches,sessionUser,tokenUser};
}
