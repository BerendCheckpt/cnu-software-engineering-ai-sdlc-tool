export interface SonarHotspot {
  ruleKey: string;
  vulnerabilityProbability: string;
  component: string;
  line?: number;
  message: string;
}
