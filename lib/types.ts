export type TicketStatus = 'waiting' | 'in-consultation' | 'completed' | 'skipped' | 'cancelled';
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

export interface Ticket {
  id: string;
  token_number: string;
  patient_name: string;
  phone_number?: string;
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
