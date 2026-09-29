export type Risk = 'SAFE' | 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export const RISK_ORDER: Risk[] = ['SAFE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export type AutonomyLevel = 0 | 1 | 2 | 3 | 4 | 5;
export type ActorType = 'ai' | 'user' | 'system';
export interface CapabilityRequest {
  guildId: string; actorId: string; actorType: ActorType;
  tool: string; input: unknown; correlationId: string; targetId?: string; confirmedBy?: string;
}
export interface GuildPolicy {
  autonomy: AutonomyLevel; disabledTools: string[]; protectedIds: string[]; allowAutoCritical: boolean;
}
export type Decision =
  | { status: 'executed'; result: unknown }
  | { status: 'needs_confirmation'; reason: string }
  | { status: 'denied'; reason: string };
