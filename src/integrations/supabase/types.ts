export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      attendance: {
        Row: {
          created_at: string
          date: string
          employee_id: string
          hours_worked: number
          id: string
          logged_by: string | null
          mine_id: string | null
          notes: string | null
          overtime_hours: number
          shift: Database["public"]["Enums"]["shift_slot"]
          status: Database["public"]["Enums"]["attendance_status"]
          tons_contributed: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          date?: string
          employee_id: string
          hours_worked?: number
          id?: string
          logged_by?: string | null
          mine_id?: string | null
          notes?: string | null
          overtime_hours?: number
          shift?: Database["public"]["Enums"]["shift_slot"]
          status?: Database["public"]["Enums"]["attendance_status"]
          tons_contributed?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          employee_id?: string
          hours_worked?: number
          id?: string
          logged_by?: string | null
          mine_id?: string | null
          notes?: string | null
          overtime_hours?: number
          shift?: Database["public"]["Enums"]["shift_slot"]
          status?: Database["public"]["Enums"]["attendance_status"]
          tons_contributed?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "attendance_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "attendance_mine_id_fkey"
            columns: ["mine_id"]
            isOneToOne: false
            referencedRelation: "mines"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          active: boolean
          contact_email: string | null
          contact_name: string | null
          contact_phone: string | null
          contract_end: string | null
          contract_revenue_monthly: number | null
          contract_start: string | null
          created_at: string
          id: string
          name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contract_end?: string | null
          contract_revenue_monthly?: number | null
          contract_start?: string | null
          created_at?: string
          id?: string
          name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          contact_email?: string | null
          contact_name?: string | null
          contact_phone?: string | null
          contract_end?: string | null
          contract_revenue_monthly?: number | null
          contract_start?: string | null
          created_at?: string
          id?: string
          name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      downtime_events: {
        Row: {
          created_at: string
          duration_hours: number
          equipment_id: string | null
          estimated_cost: number
          id: string
          logged_by: string | null
          mine_id: string | null
          notes: string | null
          photo_urls: string[]
          reason: string
          start_time: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          duration_hours?: number
          equipment_id?: string | null
          estimated_cost?: number
          id?: string
          logged_by?: string | null
          mine_id?: string | null
          notes?: string | null
          photo_urls?: string[]
          reason: string
          start_time?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          duration_hours?: number
          equipment_id?: string | null
          estimated_cost?: number
          id?: string
          logged_by?: string | null
          mine_id?: string | null
          notes?: string | null
          photo_urls?: string[]
          reason?: string
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "downtime_events_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "downtime_events_mine_id_fkey"
            columns: ["mine_id"]
            isOneToOne: false
            referencedRelation: "mines"
            referencedColumns: ["id"]
          },
        ]
      }
      employee_transfers: {
        Row: {
          created_at: string
          employee_id: string
          from_mine_id: string | null
          id: string
          reason: string | null
          to_mine_id: string | null
          transfer_date: string
        }
        Insert: {
          created_at?: string
          employee_id: string
          from_mine_id?: string | null
          id?: string
          reason?: string | null
          to_mine_id?: string | null
          transfer_date?: string
        }
        Update: {
          created_at?: string
          employee_id?: string
          from_mine_id?: string | null
          id?: string
          reason?: string | null
          to_mine_id?: string | null
          transfer_date?: string
        }
        Relationships: [
          {
            foreignKeyName: "employee_transfers_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_transfers_from_mine_id_fkey"
            columns: ["from_mine_id"]
            isOneToOne: false
            referencedRelation: "mines"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employee_transfers_to_mine_id_fkey"
            columns: ["to_mine_id"]
            isOneToOne: false
            referencedRelation: "mines"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          active: boolean
          created_at: string
          employee_no: string | null
          full_name: string
          hire_date: string | null
          hourly_rate: number
          id: string
          id_number: string | null
          mine_id: string | null
          notes: string | null
          phone: string | null
          position: string | null
          shift: Database["public"]["Enums"]["shift_slot"]
          team_name: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          employee_no?: string | null
          full_name: string
          hire_date?: string | null
          hourly_rate?: number
          id?: string
          id_number?: string | null
          mine_id?: string | null
          notes?: string | null
          phone?: string | null
          position?: string | null
          shift?: Database["public"]["Enums"]["shift_slot"]
          team_name?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          employee_no?: string | null
          full_name?: string
          hire_date?: string | null
          hourly_rate?: number
          id?: string
          id_number?: string | null
          mine_id?: string | null
          notes?: string | null
          phone?: string | null
          position?: string | null
          shift?: Database["public"]["Enums"]["shift_slot"]
          team_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "employees_mine_id_fkey"
            columns: ["mine_id"]
            isOneToOne: false
            referencedRelation: "mines"
            referencedColumns: ["id"]
          },
        ]
      }
      equipment: {
        Row: {
          created_at: string
          expected_life_hours: number | null
          expected_life_tons: number | null
          hours_since_install: number
          id: string
          install_date: string | null
          mine_id: string | null
          name: string
          replacement_cost: number | null
          service_interval_days: number | null
          service_interval_tons: number | null
          status: string
          tons_since_install: number
          type: string | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          expected_life_hours?: number | null
          expected_life_tons?: number | null
          hours_since_install?: number
          id?: string
          install_date?: string | null
          mine_id?: string | null
          name: string
          replacement_cost?: number | null
          service_interval_days?: number | null
          service_interval_tons?: number | null
          status?: string
          tons_since_install?: number
          type?: string | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          expected_life_hours?: number | null
          expected_life_tons?: number | null
          hours_since_install?: number
          id?: string
          install_date?: string | null
          mine_id?: string | null
          name?: string
          replacement_cost?: number | null
          service_interval_days?: number | null
          service_interval_tons?: number | null
          status?: string
          tons_since_install?: number
          type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "equipment_mine_id_fkey"
            columns: ["mine_id"]
            isOneToOne: false
            referencedRelation: "mines"
            referencedColumns: ["id"]
          },
        ]
      }
      fuel_slips: {
        Row: {
          cost_per_litre: number
          created_at: string
          date: string
          employee_id: string | null
          equipment_id: string | null
          fuel_type: string
          hours_reading: number | null
          id: string
          litres: number
          logged_by: string | null
          mine_id: string | null
          notes: string | null
          odometer: number | null
          photo_urls: string[]
          slip_no: string | null
          total_cost: number
          updated_at: string
          vehicle_label: string | null
        }
        Insert: {
          cost_per_litre?: number
          created_at?: string
          date?: string
          employee_id?: string | null
          equipment_id?: string | null
          fuel_type?: string
          hours_reading?: number | null
          id?: string
          litres?: number
          logged_by?: string | null
          mine_id?: string | null
          notes?: string | null
          odometer?: number | null
          photo_urls?: string[]
          slip_no?: string | null
          total_cost?: number
          updated_at?: string
          vehicle_label?: string | null
        }
        Update: {
          cost_per_litre?: number
          created_at?: string
          date?: string
          employee_id?: string | null
          equipment_id?: string | null
          fuel_type?: string
          hours_reading?: number | null
          id?: string
          litres?: number
          logged_by?: string | null
          mine_id?: string | null
          notes?: string | null
          odometer?: number | null
          photo_urls?: string[]
          slip_no?: string | null
          total_cost?: number
          updated_at?: string
          vehicle_label?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "fuel_slips_employee_id_fkey"
            columns: ["employee_id"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_slips_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fuel_slips_mine_id_fkey"
            columns: ["mine_id"]
            isOneToOne: false
            referencedRelation: "mines"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_logs: {
        Row: {
          created_at: string
          date: string
          description: string
          downtime_hours: number
          equipment_id: string
          id: string
          labour_cost: number
          labour_hours: number
          logged_by: string | null
          next_due_date: string | null
          next_due_tons: number | null
          parts_cost: number
          performed_by: string | null
          photo_urls: string[]
          total_cost: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          date?: string
          description: string
          downtime_hours?: number
          equipment_id: string
          id?: string
          labour_cost?: number
          labour_hours?: number
          logged_by?: string | null
          next_due_date?: string | null
          next_due_tons?: number | null
          parts_cost?: number
          performed_by?: string | null
          photo_urls?: string[]
          total_cost?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          description?: string
          downtime_hours?: number
          equipment_id?: string
          id?: string
          labour_cost?: number
          labour_hours?: number
          logged_by?: string | null
          next_due_date?: string | null
          next_due_tons?: number | null
          parts_cost?: number
          performed_by?: string | null
          photo_urls?: string[]
          total_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_logs_equipment_id_fkey"
            columns: ["equipment_id"]
            isOneToOne: false
            referencedRelation: "equipment"
            referencedColumns: ["id"]
          },
        ]
      }
      maintenance_parts: {
        Row: {
          created_at: string
          id: string
          maintenance_id: string
          qty: number
          stock_item_id: string | null
          unit_cost: number
        }
        Insert: {
          created_at?: string
          id?: string
          maintenance_id: string
          qty?: number
          stock_item_id?: string | null
          unit_cost?: number
        }
        Update: {
          created_at?: string
          id?: string
          maintenance_id?: string
          qty?: number
          stock_item_id?: string | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "maintenance_parts_maintenance_id_fkey"
            columns: ["maintenance_id"]
            isOneToOne: false
            referencedRelation: "maintenance_logs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "maintenance_parts_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      mines: {
        Row: {
          active: boolean
          client_id: string | null
          created_at: string
          id: string
          location: string | null
          name: string
          target_cost_per_ton: number | null
          team_name: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          client_id?: string | null
          created_at?: string
          id?: string
          location?: string | null
          name: string
          target_cost_per_ton?: number | null
          team_name?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          client_id?: string | null
          created_at?: string
          id?: string
          location?: string | null
          name?: string
          target_cost_per_ton?: number | null
          team_name?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "mines_client_id_fkey"
            columns: ["client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["id"]
          },
        ]
      }
      po_lines: {
        Row: {
          created_at: string
          id: string
          po_id: string
          qty: number
          stock_item_id: string | null
          unit_cost: number
        }
        Insert: {
          created_at?: string
          id?: string
          po_id: string
          qty?: number
          stock_item_id?: string | null
          unit_cost?: number
        }
        Update: {
          created_at?: string
          id?: string
          po_id?: string
          qty?: number
          stock_item_id?: string | null
          unit_cost?: number
        }
        Relationships: [
          {
            foreignKeyName: "po_lines_po_id_fkey"
            columns: ["po_id"]
            isOneToOne: false
            referencedRelation: "purchase_orders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "po_lines_stock_item_id_fkey"
            columns: ["stock_item_id"]
            isOneToOne: false
            referencedRelation: "stock_items"
            referencedColumns: ["id"]
          },
        ]
      }
      production_logs: {
        Row: {
          created_at: string
          date: string
          id: string
          magnetite_cost: number
          magnetite_used: number
          mine_id: string
          notes: string | null
          overtime_cost: number
          overtime_hours: number
          shift: Database["public"]["Enums"]["shift_slot"] | null
          team_name: string | null
          tons_produced: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          date?: string
          id?: string
          magnetite_cost?: number
          magnetite_used?: number
          mine_id: string
          notes?: string | null
          overtime_cost?: number
          overtime_hours?: number
          shift?: Database["public"]["Enums"]["shift_slot"] | null
          team_name?: string | null
          tons_produced?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          date?: string
          id?: string
          magnetite_cost?: number
          magnetite_used?: number
          mine_id?: string
          notes?: string | null
          overtime_cost?: number
          overtime_hours?: number
          shift?: Database["public"]["Enums"]["shift_slot"] | null
          team_name?: string | null
          tons_produced?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "production_logs_mine_id_fkey"
            columns: ["mine_id"]
            isOneToOne: false
            referencedRelation: "mines"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      purchase_orders: {
        Row: {
          approved_at: string | null
          created_at: string
          id: string
          notes: string | null
          ordered_at: string | null
          received_at: string | null
          status: Database["public"]["Enums"]["po_status"]
          supplier_id: string | null
          total_cost: number
          updated_at: string
        }
        Insert: {
          approved_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          ordered_at?: string | null
          received_at?: string | null
          status?: Database["public"]["Enums"]["po_status"]
          supplier_id?: string | null
          total_cost?: number
          updated_at?: string
        }
        Update: {
          approved_at?: string | null
          created_at?: string
          id?: string
          notes?: string | null
          ordered_at?: string | null
          received_at?: string | null
          status?: Database["public"]["Enums"]["po_status"]
          supplier_id?: string | null
          total_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "purchase_orders_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      reefie_messages: {
        Row: {
          created_at: string
          id: string
          message: Json
          role: string
          thread_id: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          message: Json
          role: string
          thread_id: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          message?: Json
          role?: string
          thread_id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "reefie_messages_thread_id_fkey"
            columns: ["thread_id"]
            isOneToOne: false
            referencedRelation: "reefie_threads"
            referencedColumns: ["id"]
          },
        ]
      }
      reefie_threads: {
        Row: {
          created_at: string
          id: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          id?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      static_costs: {
        Row: {
          amount: number
          category: string
          created_at: string
          id: string
          mine_id: string | null
          month: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          amount?: number
          category: string
          created_at?: string
          id?: string
          mine_id?: string | null
          month: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          amount?: number
          category?: string
          created_at?: string
          id?: string
          mine_id?: string | null
          month?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "static_costs_mine_id_fkey"
            columns: ["mine_id"]
            isOneToOne: false
            referencedRelation: "mines"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_items: {
        Row: {
          created_at: string
          id: string
          name: string
          qty_on_hand: number
          reorder_point: number
          reorder_qty: number
          sku: string | null
          supplier_id: string | null
          unit: string | null
          unit_cost: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          qty_on_hand?: number
          reorder_point?: number
          reorder_qty?: number
          sku?: string | null
          supplier_id?: string | null
          unit?: string | null
          unit_cost?: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          qty_on_hand?: number
          reorder_point?: number
          reorder_qty?: number
          sku?: string | null
          supplier_id?: string | null
          unit?: string | null
          unit_cost?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_items_supplier_id_fkey"
            columns: ["supplier_id"]
            isOneToOne: false
            referencedRelation: "suppliers"
            referencedColumns: ["id"]
          },
        ]
      }
      suppliers: {
        Row: {
          contact_name: string | null
          created_at: string
          email: string | null
          id: string
          name: string
          notes: string | null
          phone: string | null
          updated_at: string
        }
        Insert: {
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Update: {
          contact_name?: string | null
          created_at?: string
          email?: string | null
          id?: string
          name?: string
          notes?: string | null
          phone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_manager: { Args: { _uid: string }; Returns: boolean }
    }
    Enums: {
      app_role:
        | "owner"
        | "manager"
        | "supervisor"
        | "stock_controller"
        | "worker"
      attendance_status: "present" | "absent" | "late" | "leave" | "sick"
      po_status: "draft" | "approved" | "ordered" | "received" | "cancelled"
      shift_slot: "morning" | "midday" | "night"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "owner",
        "manager",
        "supervisor",
        "stock_controller",
        "worker",
      ],
      attendance_status: ["present", "absent", "late", "leave", "sick"],
      po_status: ["draft", "approved", "ordered", "received", "cancelled"],
      shift_slot: ["morning", "midday", "night"],
    },
  },
} as const
