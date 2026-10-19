// Reuse every validation, moderation and abuse control, including the shared
// rate-limit bucket. The handler recognizes this exact path for its date gate.
export { POST } from "../route";
export const dynamic = "force-dynamic";
