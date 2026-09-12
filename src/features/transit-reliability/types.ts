export type ReliabilityMode = 'BUS' | 'MRT' | 'LRT' | 'BRT';
export type RiskLevel = 'low' | 'moderate' | 'high' | 'very_high';

export interface ReliabilityQuery {
  mode: ReliabilityMode;
  lineId: string;
  stopId: string;
  datetime: string;
}

export interface UnsupportedPrediction {
  supported: false;
  reason: 'insufficient_historical_operational_data' | 'unknown_service' | string;
}

export interface ReliabilityPrediction {
  supported: true;
  prediction_type: 'historical' | 'live_adjusted';
  expected_delay_min: number;
  risk_level: RiskLevel;
  historical_percentile: number;
  prediction_lower_min: number | null;
  prediction_upper_min: number | null;
  scheduled_headway_min: number | null;
  observed_headway_min: number | null;
  realtime_used: boolean;
  realtime_timestamp: string | null;
  model_version: string;
  model_type: string;
  data_sources: string[];
  training_period: string;
  evaluation: Record<string, number>;
  explanations: string[];
  disclaimer: string;
}

export type ReliabilityResponse = ReliabilityPrediction | UnsupportedPrediction;

export interface ReliabilityService {
  mode: ReliabilityMode;
  line_id: string;
  name: string;
  prediction_available: boolean;
  stops: { stop_id: string; name: string }[];
}
