# REEF database diagram

The entity-relationship diagram below is generated from the migrations in
`supabase/migrations/`. It reflects the schema as of the T14 merge (2026-10-04).

```mermaid
erDiagram
    clients ||--o{ mines : "operates at"
    clients {
        uuid id PK
        text name
        text contact_name
        text contact_email
        text contact_phone
        date contract_start
        date contract_end
        numeric contract_revenue_monthly
        boolean active
        text notes
        int version
        timestamptz created_at
        timestamptz updated_at
    }

    mines ||--o{ equipment : "has"
    mines ||--o{ employees : "employs"
    mines ||--o{ production_logs : "produces"
    mines ||--o{ static_costs : "incurs"
    mines ||--o{ downtime_events : "records"
    mines {
        uuid id PK
        uuid client_id FK
        text name
        text location
        text team_name
        numeric target_cost_per_ton
        boolean active
        int version
        timestamptz created_at
        timestamptz updated_at
    }

    equipment ||--o{ maintenance_logs : "serviced by"
    equipment {
        uuid id PK
        uuid mine_id FK
        text name
        text type
        date install_date
        numeric expected_life_tons
        numeric expected_life_hours
        numeric tons_since_install
        numeric hours_since_install
        numeric service_interval_tons
        int service_interval_days
        numeric replacement_cost
        text status
        int version
        timestamptz created_at
        timestamptz updated_at
    }

    employees ||--o{ attendance : "clocks in"
    employees ||--o{ employee_transfers : "transferred"
    employees ||--o| employee_personal_information : "protected identity"
    employees ||--o{ personal_information_audit : "disclosure attempts"
    employees {
        uuid id PK
        uuid mine_id FK
        text full_name
        text employee_no
        text position
        text phone
        text shift
        text team_name
        numeric hourly_rate
        boolean active
        int version
        timestamptz created_at
        timestamptz updated_at
    }

    employee_personal_information {
        uuid employee_id PK
        text id_number
    }

    personal_information_audit {
        uuid id PK
        uuid user_id FK
        uuid employee_id FK
        text action
        boolean allowed
        text reason
        timestamptz created_at
    }

    suppliers ||--o{ stock_items : "supplies"
    suppliers ||--o{ purchase_orders : "receives"
    suppliers {
        uuid id PK
        text name
        text contact_name
        text email
        text phone
        text notes
        int version
        timestamptz created_at
        timestamptz updated_at
    }

    stock_items ||--o{ stock_levels : "held at each plant"
    stock_items ||--o{ po_lines : "ordered on"
    stock_items ||--o{ maintenance_parts : "consumed in"
    stock_items {
        uuid id PK
        text name
        text sku
        text unit
        numeric unit_cost
        uuid supplier_id FK
        int version
        timestamptz created_at
        timestamptz updated_at
    }

    stock_levels {
        uuid id PK
        uuid stock_item_id FK
        text plant
        numeric qty_on_hand
        numeric reorder_point
        numeric reorder_qty
        int version
        timestamptz created_at
        timestamptz updated_at
    }

    purchase_orders ||--o{ po_lines : "contains"
    purchase_orders {
        uuid id PK
        uuid supplier_id FK
        text plant
        po_status status
        numeric total_cost
        text notes
        timestamptz approved_at
        timestamptz ordered_at
        timestamptz received_at
        int version
        timestamptz created_at
        timestamptz updated_at
    }

    po_lines {
        uuid id PK
        uuid po_id FK
        uuid stock_item_id FK
        numeric qty
        numeric unit_cost
        timestamptz created_at
    }

    maintenance_logs ||--o{ maintenance_parts : "consumes"
    maintenance_logs {
        uuid id PK
        uuid equipment_id FK
        date date
        text description
        numeric labour_hours
        numeric labour_cost
        numeric parts_cost
        numeric total_cost
        numeric downtime_hours
        date next_due_date
        numeric next_due_tons
        text performed_by
        int version
        timestamptz created_at
        timestamptz updated_at
    }

    maintenance_parts {
        uuid id PK
        uuid maintenance_id FK
        uuid stock_item_id FK
        numeric qty
        numeric unit_cost
        timestamptz created_at
    }

    production_logs {
        uuid id PK
        uuid mine_id FK
        date date
        numeric tons_produced
        numeric magnetite_used
        numeric magnetite_cost
        numeric overtime_hours
        numeric overtime_cost
        text notes
        int version
        timestamptz created_at
        timestamptz updated_at
    }

    static_costs {
        uuid id PK
        uuid mine_id FK
        date month
        text category
        numeric amount
        text notes
        int version
        timestamptz created_at
        timestamptz updated_at
    }

    attendance {
        uuid id PK
        uuid employee_id FK
        uuid mine_id FK
        date date
        text shift
        text status
        numeric hours_worked
        numeric overtime_hours
        numeric tons_contributed
        text notes
        int version
        timestamptz created_at
        timestamptz updated_at
    }

    employee_transfers {
        uuid id PK
        uuid employee_id FK
        uuid from_mine_id FK
        uuid to_mine_id FK
        date transfer_date
        text reason
        int version
        timestamptz created_at
        timestamptz updated_at
    }

    downtime_events {
        uuid id PK
        uuid mine_id FK
        text reason
        timestamptz start_time
        numeric duration_hours
        numeric estimated_cost
        int version
        timestamptz created_at
        timestamptz updated_at
    }

    fuel_slips {
        uuid id PK
        text vehicle
        date date
        numeric litres
        numeric cost_per_litre
        numeric total_cost
        numeric odometer
        int version
        timestamptz created_at
        timestamptz updated_at
    }

    profiles ||--o{ user_roles : "held by"
    profiles {
        uuid id PK
        text full_name
        text email
        text plant
        timestamptz created_at
        timestamptz updated_at
    }

    user_roles {
        uuid id PK
        uuid user_id FK
        app_role role
    }

    history {
        uuid id PK
        text table_name
        uuid row_id
        uuid changed_by FK
        text reason
        text plant
        jsonb old_values
        jsonb new_values
        int version
        timestamptz changed_at
    }

    reefie_threads ||--o{ reefie_messages : "contains"
    reefie_threads ||--o{ reefie_answer_checks : "audited by"
    reefie_threads {
        uuid id PK
        uuid user_id FK
        text title
        timestamptz created_at
        timestamptz updated_at
    }

    reefie_messages {
        uuid id PK
        uuid thread_id FK
        uuid user_id FK
        text role
        jsonb message
        timestamptz created_at
    }

    reefie_answer_checks {
        uuid id PK
        uuid thread_id FK
        uuid user_id FK
        boolean passed
        jsonb unverified_numbers
        timestamptz created_at
    }