export type TicketStatus = 'waiting' | 'in-consultation' | 'completed' | 'skipped' | 'cancelled' | 'expired';
export type PriorityType = 'normal' | 'emergency' | 'senior';

export interface Department {
  id: string;
  name: string;
  code: string;
  description?: string;
  created_at: string;
}

export interface Doctor {
  id: string;
  name: string;
  department_id: string;
  room_number: string;
  is_available: boolean;
  created_at: string;
  departments?: Department;
}

export interface DoctorSlot {
  id: string;
  doctor_id: string;
  slot_name: string;
  start_time: string;
  end_time: string;
  is_active: boolean;
}

export interface Ticket {
  id: string;
  token_number: number;
  token_code: string;
  slot_id: string | null;
  booking_date: string;
  patient_name: string;
  phone_number?: string;
  patient_age?: number;
  patient_gender?: string;
  paid_amount?: number | null;
  payment_mode?: 'CASH' | 'UPI' | 'CARD' | 'OTHER' | 'NONE' | null;
  rating?: number | null;
  department_id: string;
  doctor_id?: string;
  status: TicketStatus;
  priority: PriorityType;
  notes?: string;
  called_at?: string;
  completed_at?: string;
  created_at: string;
  departments?: Department;
  doctors?: Doctor;
}
