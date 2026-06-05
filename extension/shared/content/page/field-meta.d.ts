export function fieldKindFor(input: Element): string | undefined;
export function suggestionFlowFor(input: Element, fieldKind?: string): 'payment' | 'register' | 'login';
export function shouldOfferSuggestedPassword(input: Element): boolean;
