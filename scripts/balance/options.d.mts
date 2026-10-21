export interface BalanceOptions { command: 'analyze' | 'simulate' | 'report'; seed: string; runs: number; profile: 'all' | 'beginner' | 'casual' | 'expert'; distance: number; output: string; variant: 'baseline' | 'proposed'; comparisons: number; careers: number; careerRuns: number }
export function parseOptions(argv: string[]): BalanceOptions;
