/**
 * ==============================================================================
 * ResDigital — MOD-00 Auth y Tenant: Script de Seed para Desarrollo Local
 * ==============================================================================
 *
 * ADVERTENCIA ESTRICTA:
 * Este script es EXCLUSIVO para desarrollo local y pruebas de integración.
 * NUNCA DEBE EJECUTARSE EN ENTORNOS DE PRODUCCIÓN.
 * Contiene credenciales fijas para facilitar el trabajo del equipo
 * (Danny, Ari, Karla, Cristhian).
 * ==============================================================================
 */

import { createClient } from '@supabase/supabase-js';
import { DataSource } from 'typeorm';
import { dataSourceOptions } from '../data-source.js';
import { RolesService } from '../../auth/services/roles.service.js';
import { AuditAuthService } from '../../auth/services/audit-auth.service.js';
import type { RolUsuario } from '../../auth/interfaces/authenticated-user.interface.js';

// 1. Salvaguarda obligatoria contra ejecución accidental en producción
if (process.env.NODE_ENV === 'production') {
  console.error('❌ [ERROR CRÍTICO] Intento de ejecutar seed:dev en ambiente de PRODUCCIÓN detectado.');
  console.error('El script ha sido abortado inmediatamente por seguridad.');
  process.exit(1);
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ [ERROR] Faltan variables de entorno requeridas: SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY.');
  console.error('Asegúrese de configurar el archivo .env en el backend.');
  process.exit(1);
}

// 2. Cliente con privilegios administrativos de Supabase (Admin API)
const supabaseAdmin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const NOMBRE_FINCA_DEMO = 'Finca Demo ResDigital';

interface DevUserSeed {
  email: string;
  password: string;
  nombreCompleto: string;
  rol: RolUsuario;
  descripcion: string;
}

const USUARIOS_SEED: DevUserSeed[] = [
  {
    email: 'propietario@fincademo.cr',
    password: 'DemoPassword2026!',
    nombreCompleto: 'Carlos Propietario Demo',
    rol: 'propietario',
    descripcion: 'Control total de la finca, configuración y gestión de usuarios',
  },
  {
    email: 'admin@fincademo.cr',
    password: 'DemoPassword2026!',
    nombreCompleto: 'Ana Administradora Demo',
    rol: 'administrador',
    descripcion: 'Operación diaria del hato, alertas, inventario y reportes',
  },
  {
    email: 'peon@fincademo.cr',
    password: 'DemoPassword2026!',
    nombreCompleto: 'Pedro Peón Demo',
    rol: 'peon',
    descripcion: 'Registro de campo: pesajes, servicios, partos, ordeños',
  },
  {
    email: 'veterinario@fincademo.cr',
    password: 'DemoPassword2026!',
    nombreCompleto: 'Valeria Veterinaria Demo',
    rol: 'veterinario',
    descripcion: 'Historial clínico, diagnósticos, protocolos sanitarios y recetas',
  },
];

async function runSeed() {
  console.log('\n===============================================================================');
  console.log('            🌱 RESDIGITAL — SEED DE DESARROLLO LOCAL (MOD-00)                 ');
  console.log('===============================================================================');
  console.log(`[INFO] Conectando a Supabase Admin API: ${SUPABASE_URL}`);

  // 3. Inicializar DataSource de TypeORM para RolesService y Auditoría (si hay BD directa)
  let dataSource: DataSource | undefined;
  try {
    dataSource = new DataSource(dataSourceOptions);
    await dataSource.initialize();
    console.log('✅ [OK] Conexión directa a PostgreSQL inicializada para RolesService.');
  } catch (dbError) {
    console.log(
      `ℹ️ [INFO] Conexión directa PostgreSQL no activa (${(dbError as Error).message.split('\n')[0]}).`,
    );
    console.log('   RolesService y sincronización operarán vía Supabase Admin API (Service Role).');
    dataSource = undefined;
  }

  const auditService = new AuditAuthService();
  const rolesService = new RolesService(auditService);

  // 4. Gestionar Tenant de Prueba Único (Idempotente)
  console.log(`\n--- Paso 1: Verificando Tenant Único '${NOMBRE_FINCA_DEMO}' ---`);
  let tenantId: string | null = null;

  const { data: existingTenants, error: searchTenantError } = await supabaseAdmin
    .from('tenant')
    .select('id, nombre_finca')
    .eq('nombre_finca', NOMBRE_FINCA_DEMO)
    .order('created_at', { ascending: true });

  if (searchTenantError) {
    console.warn(`⚠️ [AVISO] Consulta a tenant: ${searchTenantError.message}`);
  }

  if (existingTenants && existingTenants.length > 0) {
    // Tomar el primer tenant como el oficial
    tenantId = existingTenants[0].id;
    console.log(`ℹ️ [IDEMPOTENTE] Tenant demo oficial detectado. ID: ${tenantId}`);

    // Limpiar tenants duplicados si hubiesen sido creados en corridas previas
    if (existingTenants.length > 1) {
      const extraTenantIds = existingTenants.slice(1).map((t) => t.id);
      console.log(`🧹 [LIMPIEZA] Eliminando ${extraTenantIds.length} tenant(s) duplicado(s)...`);
      for (const extraId of extraTenantIds) {
        await supabaseAdmin.from('usuario').update({ tenant_id: tenantId }).eq('tenant_id', extraId);
        await supabaseAdmin.from('tenant').delete().eq('id', extraId);
      }
    }
  } else {
    const { data: newTenant, error: createTenantError } = await supabaseAdmin
      .from('tenant')
      .insert({ nombre_finca: NOMBRE_FINCA_DEMO })
      .select('id')
      .single();

    if (createTenantError || !newTenant) {
      console.warn(`⚠️ [AVISO] Inserción directa de tenant falló: ${createTenantError?.message}`);
    } else {
      tenantId = newTenant.id;
      console.log(`✅ [OK] Tenant creado exitosamente. ID: ${tenantId}`);
    }
  }

  // 5. Crear o Sincronizar los 4 Usuarios en Supabase Auth
  console.log(`\n--- Paso 2: Verificando Usuarios en Supabase Auth (4 Roles) ---`);

  const { data: authUsersData, error: listError } = await supabaseAdmin.auth.admin.listUsers({
    perPage: 100,
  });

  if (listError) {
    console.error(`❌ [ERROR] Fallo al listar usuarios en Supabase Auth: ${listError.message}`);
    process.exit(1);
  }

  const existingAuthUsers = authUsersData.users || [];
  const seededAccounts: { rol: RolUsuario; email: string; pass: string; id: string }[] = [];

  for (const userConfig of USUARIOS_SEED) {
    const existing = existingAuthUsers.find(
      (u) => u.email?.toLowerCase() === userConfig.email.toLowerCase(),
    );

    let authUserId: string;

    if (existing) {
      authUserId = existing.id;
      console.log(`ℹ️ [IDEMPOTENTE] Usuario '${userConfig.email}' (${userConfig.rol}) ya existe en Auth (ID: ${authUserId}).`);

      // Asegurar metadata actualizada con tenant_id y rol
      await supabaseAdmin.auth.admin.updateUserById(authUserId, {
        app_metadata: {
          tenant_id: tenantId,
          rol: userConfig.rol,
        },
      });
    } else {
      const { data: newUser, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: userConfig.email,
        password: userConfig.password,
        email_confirm: true,
        user_metadata: {
          nombre_completo: userConfig.nombreCompleto,
          nombre_finca: NOMBRE_FINCA_DEMO,
        },
        app_metadata: {
          tenant_id: tenantId || undefined,
          rol: userConfig.rol,
        },
      });

      if (createError || !newUser.user) {
        console.error(`❌ [ERROR] No se pudo crear usuario '${userConfig.email}': ${createError?.message}`);
        continue;
      }

      authUserId = newUser.user.id;
      console.log(`✅ [OK] Creado usuario Auth '${userConfig.email}' (ID: ${authUserId}).`);
    }

    // Resolver tenantId si aún no existía
    if (!tenantId) {
      const { data: usuarioRow } = await supabaseAdmin
        .from('usuario')
        .select('tenant_id')
        .eq('id', authUserId)
        .maybeSingle();

      if (usuarioRow?.tenant_id) {
        tenantId = usuarioRow.tenant_id;
        console.log(`ℹ️ [TENANT DETECTADO] Tenant ID obtenido: ${tenantId}`);
      }
    }

    // 6. Asignación y Certificación de Rol vía RolesService y Supabase Admin
    if (tenantId) {
      try {
        // Asegurar que el registro en public.usuario existe y pertenece al tenant común
        const { data: userRow } = await supabaseAdmin
          .from('usuario')
          .select('id, rol, tenant_id')
          .eq('id', authUserId)
          .maybeSingle();

        if (!userRow) {
          await supabaseAdmin.from('usuario').insert({
            id: authUserId,
            tenant_id: tenantId,
            nombre_completo: userConfig.nombreCompleto,
            correo: userConfig.email,
            rol: userConfig.rol,
            activo: true,
          });
        } else {
          await supabaseAdmin
            .from('usuario')
            .update({
              tenant_id: tenantId,
              rol: userConfig.rol,
            })
            .eq('id', authUserId);
        }

        if (!dataSource?.isInitialized) {
          throw new Error(
            'No se puede certificar el cambio de rol sin conexión PostgreSQL.',
          );
        }
        const resolvedTenantId = tenantId;

        await dataSource.transaction(async (manager) => {
          await manager.query('SELECT set_config($1, $2, true);', [
            'request.jwt.claims',
            JSON.stringify({
              sub: authUserId,
              tenant_id: resolvedTenantId,
              rol: userConfig.rol,
            }),
          ]);
          await manager.query('SELECT set_config($1, $2, true);', [
            'app.current_tenant_id',
            resolvedTenantId,
          ]);
          await manager.query('SET LOCAL ROLE resdigital_app;');
          await rolesService.assignRole(
            authUserId,
            resolvedTenantId,
            userConfig.rol,
            'SEED_DEV',
            manager,
          );
        });
        console.log(`  └─ Rol '${userConfig.rol}' certificado por RolesService para ${userConfig.email}`);

        // Asegurar app_metadata en Supabase Auth
        await supabaseAdmin.auth.admin.updateUserById(authUserId, {
          app_metadata: {
            tenant_id: tenantId,
            rol: userConfig.rol,
          },
        });
      } catch (roleError) {
        console.warn(`  └─ Aviso en asignación de rol: ${(roleError as Error).message}`);
      }
    }

    seededAccounts.push({
      rol: userConfig.rol,
      email: userConfig.email,
      pass: userConfig.password,
      id: authUserId,
    });
  }

  // 6.5 Insertar Catálogo de Razas y Animales de Prueba
  console.log(`\n--- Paso 3: Insertando catálogo de razas y animales ---`);
  if (tenantId) {
    const razas = [
      { nombre: 'Holstein', dias_gestacion: 281 },
      { nombre: 'Jersey', dias_gestacion: 279 },
      { nombre: 'Pardo Suizo', dias_gestacion: 290 },
      { nombre: 'Brahman', dias_gestacion: 293 },
      { nombre: 'Nelore', dias_gestacion: 293 },
      { nombre: 'Girolando', dias_gestacion: 290 },
      { nombre: 'Criolla', dias_gestacion: 283 },
      { nombre: 'Mestiza', dias_gestacion: 283 },
      { nombre: 'Otra', dias_gestacion: 283 },
    ];

    for (const raza of razas) {
      const { data: existing } = await supabaseAdmin.from('catalogo_raza').select('id').eq('nombre', raza.nombre).maybeSingle();
      if (!existing) {
         await supabaseAdmin.from('catalogo_raza').insert({ nombre: raza.nombre, dias_gestacion: raza.dias_gestacion });
      }
    }
    console.log('✅ Catálogo de razas verificado/insertado.');

    const { data: holstein } = await supabaseAdmin.from('catalogo_raza').select('id').eq('nombre', 'Holstein').maybeSingle();
    const { data: brahman } = await supabaseAdmin.from('catalogo_raza').select('id').eq('nombre', 'Brahman').maybeSingle();

    if (holstein && brahman) {
      const animales = [
        { tenant_id: tenantId, nombre: 'Lola', arete_interno: '101', sexo: 'Hembra', raza_id: holstein.id, categoria: 'Vaca en Ordeño', activo: true },
        { tenant_id: tenantId, nombre: 'Manchas', arete_interno: '102', sexo: 'Hembra', raza_id: holstein.id, categoria: 'Vaca Seca', activo: true },
        { tenant_id: tenantId, nombre: 'Toro Max', arete_interno: '103', sexo: 'Macho', raza_id: brahman.id, categoria: 'Semental/Reproductor', activo: true }
      ];

      for (const animal of animales) {
        const { data: existingAnimal } = await supabaseAdmin.from('animal').select('id').eq('tenant_id', tenantId).eq('arete_interno', animal.arete_interno).maybeSingle();
        if (!existingAnimal) {
          await supabaseAdmin.from('animal').insert(animal);
        }
      }
      console.log('✅ Animales de prueba verificados/insertados.');
    }
  }

  // 7. Cerrar conexión a base de datos si fue abierta
  if (dataSource?.isInitialized) {
    await dataSource.destroy();
  }

  // 8. Impresión de Credenciales Formateadas en Consola
  console.log('\n===============================================================================');
  console.log('                 🔐 CREDENCIALES DE PRUEBA — RESDIGITAL                        ');
  console.log('        ⚠️ [SOLO PARA DESARROLLO LOCAL — NUNCA USAR EN PRODUCCIÓN]             ');
  console.log('===============================================================================');
  console.log(`Finca / Tenant: "${NOMBRE_FINCA_DEMO}"`);
  console.log(`Tenant ID:     ${tenantId}\n`);

  for (const account of seededAccounts) {
    const info = USUARIOS_SEED.find((u) => u.rol === account.rol)!;
    console.log(`-------------------------------------------------------------------------------`);
    console.log(`Rol:         ${account.rol.toUpperCase()}`);
    console.log(`Nombre:      ${info.nombreCompleto}`);
    console.log(`Correo:      ${account.email}`);
    console.log(`Contraseña:  ${account.pass}`);
    console.log(`Permisos:    ${info.descripcion}`);
  }

  console.log('===============================================================================');
  console.log('✅ Seed de desarrollo local finalizado con éxito.\n');
}

runSeed().catch((err) => {
  console.error('❌ [FATAL] Error inesperado en el script de seed:', err);
  process.exit(1);
});
