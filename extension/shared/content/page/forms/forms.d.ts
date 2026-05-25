export function randomPassword(length?: number): string;
export function detectAuthFlow(input?: Element): 'payment' | 'register' | 'login';
export function hydratePendingAuthState(): Promise<unknown[]>;
export function getPendingOtp(): string;
export function setPendingOtp(otp?: string): Promise<unknown>;
