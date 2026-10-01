import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth, onAuthStateChanged, createUserWithEmailAndPassword,
  signInWithEmailAndPassword, signInAnonymously, signOut
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  getFirestore, doc, getDoc, setDoc, collection, addDoc, updateDoc,
  deleteDoc, onSnapshot, query, orderBy, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { crearDatosPrueba } from "./datos-prueba.js";

// Cada regalo: titulo, enlace, imagen, compradoUid (quién lo compró) y compradoPor (nombre)
const MAX_REGALOS = 20;
const DOMINIO = "@regalos.app"; // el usuario se convierte en usuario@regalos.app para Firebase

const $ = function (id) { return document.getElementById(id); };

// Si la URL trae "?lista=...", quien entra es un invitado
const listaId = new URLSearchParams(location.search).get("lista");
const esInvitado = !!listaId;

if (firebaseConfig.apiKey === "PEGA_AQUI") {
  $("subtitulo").textContent = "Falta configurar Firebase: abre firebase-config.js y pega tus datos.";
  throw new Error("Firebase sin configurar");
}

// El invitado usa una app aparte para que no choque con la sesión del cumpleañero
const app = esInvitado ? initializeApp(firebaseConfig, "invitado") : initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

let datosLista = null;     // { nombre, fecha, usuario }
let miUid = null;          // uid del cumpleañero (dueño de la lista)
let regalos = [];
let editandoId = null;
let dejarDeEscuchar = null;
let ocupado = false;       // evita reaccionar al login mientras se registra o se crean datos de prueba

let nombreInvitado = null;
let uidInvitado = null;
let seleccion = new Set(); // regalos que el invitado tiene marcados
let primeraCarga = true;

// ---------- Utilidades ----------
function mostrar(ids) {
  ["pantalla-registro", "pantalla-login", "pantalla-invitado",
   "formulario-caja", "lista-caja", "qr-caja"].forEach(function (id) {
    $(id).hidden = !ids.includes(id);
  });
}

function formatearFecha(texto) {
  if (!texto) return "";
  const p = texto.split("-");
  return p[2] + "/" + p[1] + "/" + p[0];
}

function mensajeError(e) {
  const codigos = {
    "auth/invalid-credential": "Usuario o contraseña incorrectos",
    "auth/email-already-in-use": "Ese usuario ya existe",
    "auth/weak-password": "La contraseña debe tener al menos 6 caracteres",
    "auth/network-request-failed": "No hay conexión a internet",
    "auth/operation-not-allowed": "Falta activar ese método de acceso en Firebase Authentication",
    "permission-denied": "No tienes permiso para hacer eso (revisa las reglas de Firestore)"
  };
  return codigos[e.code] || ("Error: " + (e.code || e.message));
}

function detener() {
  if (dejarDeEscuchar) dejarDeEscuchar();
  dejarDeEscuchar = null;
  regalos = [];
}

// ---------- Dibujar la lista ----------
function dibujar() {
  const lista = $("lista");
  lista.innerHTML = "";
  $("vacio").hidden = regalos.length > 0;

  regalos.forEach(function (regalo) {
    const comprado = !!regalo.compradoUid;
    const esMio = esInvitado && regalo.compradoUid === uidInvitado;

    const li = document.createElement("li");
    if (comprado) li.className = "comprado";

    if (esInvitado) {
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = seleccion.has(regalo.id);
      check.title = "Marcar como comprado";
      // No se puede tocar lo que marcó otro invitado
      if (comprado && !esMio) check.disabled = true;
      check.addEventListener("change", function () {
        if (check.checked) seleccion.add(regalo.id);
        else seleccion.delete(regalo.id);
        dibujar();
      });
      li.append(check);
    }

    if (regalo.imagen) {
      const img = document.createElement("img");
      img.src = regalo.imagen;
      img.alt = regalo.titulo;
      img.className = "miniatura";
      img.addEventListener("error", function () { img.remove(); });
      li.append(img);
    }

    const info = document.createElement("div");
    info.className = "regalo-info";
    const titulo = document.createElement("strong");
    titulo.textContent = regalo.titulo;
    const enlace = document.createElement("a");
    enlace.href = regalo.enlace;
    enlace.target = "_blank";
    enlace.rel = "noopener";
    enlace.textContent = " Ver en tienda";
    info.append(titulo, document.createElement("br"), enlace);

    if (comprado) {
      const et = document.createElement("div");
      et.className = "etiqueta";
      // El cumpleañero ve que está comprado, pero no quién lo compró (es sorpresa)
      et.textContent = "✔ Ya comprado" + (esInvitado ? " por " + regalo.compradoPor : "");
      info.append(et);
    } else if (esInvitado && seleccion.has(regalo.id)) {
      const et = document.createElement("div");
      et.className = "etiqueta pendiente";
      et.textContent = "Seleccionado (falta guardar)";
      info.append(et);
    }
    li.append(info);

    if (!esInvitado) {
      const btnEditar = document.createElement("button");
      btnEditar.textContent = "Editar";
      btnEditar.addEventListener("click", function () { empezarEdicion(regalo); });

      const btnBorrar = document.createElement("button");
      btnBorrar.textContent = "Eliminar";
      btnBorrar.className = "peligro";
      btnBorrar.addEventListener("click", async function () {
        if (!confirm("¿Eliminar este regalo?")) return;
        try {
          await deleteDoc(doc(db, "listas", miUid, "regalos", regalo.id));
        } catch (e) {
          alert(mensajeError(e));
        }
      });
      li.append(btnEditar, btnBorrar);
    }

    lista.append(li);
  });
}

// ---------- Escuchar los regalos en tiempo real ----------
function escucharRegalos(idLista) {
  const consulta = query(collection(db, "listas", idLista, "regalos"), orderBy("creado"));
  dejarDeEscuchar = onSnapshot(consulta, function (snap) {
    regalos = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });

    if (esInvitado) {
      regalos.forEach(function (r) {
        // Al abrir, se marcan los que ya son míos
        if (primeraCarga && r.compradoUid === uidInvitado) seleccion.add(r.id);
        // Si otra persona compró uno que yo tenía seleccionado, se quita
        if (r.compradoUid && r.compradoUid !== uidInvitado) seleccion.delete(r.id);
      });
      primeraCarga = false;
    }
    dibujar();
  }, function (e) {
    alert(mensajeError(e));
  });
}

// ---------- Agregar y editar (cumpleañero) ----------
function empezarEdicion(regalo) {
  editandoId = regalo.id;
  $("titulo").value = regalo.titulo;
  $("enlace").value = regalo.enlace;
  $("imagen").value = regalo.imagen || "";
  actualizarVistaPrevia();
  $("form-titulo").textContent = "Editar regalo";
  $("btn-guardar").textContent = "Guardar cambios";
  $("btn-cancelar").hidden = false;
  $("titulo").focus();
}

function terminarEdicion() {
  editandoId = null;
  $("formulario").reset();
  actualizarVistaPrevia();
  $("form-titulo").textContent = "Agregar regalo";
  $("btn-guardar").textContent = "Agregar";
  $("btn-cancelar").hidden = true;
}

$("formulario").addEventListener("submit", async function (e) {
  e.preventDefault();
  const titulo = $("titulo").value.trim();
  const enlace = $("enlace").value.trim();
  const imagen = $("imagen").value.trim();
  if (!titulo || !enlace) return;

  try {
    if (editandoId) {
      await updateDoc(doc(db, "listas", miUid, "regalos", editandoId),
        { titulo: titulo, enlace: enlace, imagen: imagen });
    } else {
      if (regalos.length >= MAX_REGALOS) {
        alert("Máximo " + MAX_REGALOS + " regalos.");
        return;
      }
      await addDoc(collection(db, "listas", miUid, "regalos"), {
        titulo: titulo, enlace: enlace, imagen: imagen,
        compradoUid: "", compradoPor: "", creado: Date.now()
      });
    }
    terminarEdicion();
  } catch (err) {
    alert(mensajeError(err));
  }
});

$("btn-cancelar").addEventListener("click", terminarEdicion);

function actualizarVistaPrevia() {
  const url = $("imagen").value.trim();
  $("vista-previa").hidden = !url;
  if (url) $("vista-previa").src = url;
}

$("imagen").addEventListener("input", actualizarVistaPrevia);
$("vista-previa").addEventListener("error", function () { $("vista-previa").hidden = true; });

// ---------- QR y enlace público ----------
function actualizarQR() {
  const enlacePublico = location.origin + location.pathname + "?lista=" + miUid;
  $("enlace-publico").value = enlacePublico;
  $("qr").src = "https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=" +
    encodeURIComponent(enlacePublico);
}

$("btn-copiar").addEventListener("click", function () {
  $("enlace-publico").select();
  navigator.clipboard.writeText($("enlace-publico").value);
  alert("Enlace copiado");
});

// ---------- Cumpleañero: registro, login y panel ----------
function irARegistro() {
  detener();
  $("btn-salir").hidden = true;
  $("subtitulo").textContent = "Crea tu cuenta de cumpleañero.";
  mostrar(["pantalla-registro"]);
}

function irALogin() {
  detener();
  $("btn-salir").hidden = true;
  $("subtitulo").textContent = "Cumpleañero: inicia sesión.";
  mostrar(["pantalla-login"]);
}

$("ir-registro").addEventListener("click", irARegistro);
$("ir-login").addEventListener("click", irALogin);

$("form-registro").addEventListener("submit", async function (e) {
  e.preventDefault();
  const usuario = $("reg-usuario").value.trim().toLowerCase();
  ocupado = true;
  try {
    const cred = await createUserWithEmailAndPassword(auth, usuario + DOMINIO, $("reg-clave").value);
    await setDoc(doc(db, "listas", cred.user.uid), {
      usuario: usuario,
      nombre: $("reg-nombre").value.trim(),
      fecha: $("reg-fecha").value
    });
    ocupado = false;
    await abrirPanel(cred.user);
  } catch (err) {
    ocupado = false;
    alert(mensajeError(err));
  }
});

$("form-login").addEventListener("submit", async function (e) {
  e.preventDefault();
  const usuario = $("login-usuario").value.trim().toLowerCase();
  try {
    await signInWithEmailAndPassword(auth, usuario + DOMINIO, $("login-clave").value);
  } catch (err) {
    alert(mensajeError(err));
  }
});

$("btn-salir").addEventListener("click", function () {
  signOut(auth);
});

$("btn-prueba").addEventListener("click", async function () {
  if (!confirm("Se crearán las cuentas ana, carlos y lucia con 10 regalos cada una. ¿Continuar?")) return;
  ocupado = true;
  try {
    const resumen = await crearDatosPrueba(auth, db);
    alert("Listo:\n" + resumen.join("\n"));
  } catch (err) {
    alert(mensajeError(err));
  }
  ocupado = false;
  irALogin();
});

async function abrirPanel(usuario) {
  miUid = usuario.uid;
  try {
    const snap = await getDoc(doc(db, "listas", miUid));
    if (!snap.exists()) {
      alert("Esta cuenta no tiene lista creada.");
      signOut(auth);
      return;
    }
    datosLista = snap.data();
  } catch (err) {
    alert(mensajeError(err));
    return;
  }

  detener();
  $("subtitulo").textContent = "Hola " + datosLista.nombre + " 🎂 (" +
    formatearFecha(datosLista.fecha) + "). Crea tu lista y comparte el QR.";
  $("btn-salir").hidden = false;
  mostrar(["formulario-caja", "lista-caja", "qr-caja"]);
  actualizarQR();
  escucharRegalos(miUid);
}

// ---------- Invitado ----------
async function iniciarInvitado() {
  try {
    const snap = await getDoc(doc(db, "listas", listaId));
    if (!snap.exists()) {
      $("subtitulo").textContent = "Esta lista no existe.";
      return;
    }
    datosLista = snap.data();
  } catch (err) {
    $("subtitulo").textContent = mensajeError(err);
    return;
  }

  $("subtitulo").textContent = "Cumpleaños de " + datosLista.nombre + " 🎂 (" + formatearFecha(datosLista.fecha) + ")";
  $("invitado-texto").textContent = "Escribe tu nombre o entra como incógnito para ver los regalos que " +
    datosLista.nombre + " ha elegido.";

  const guardado = sessionStorage.getItem("nombreInvitado");
  if (guardado) entrarInvitado(guardado);
  else mostrar(["pantalla-invitado"]);
}

async function entrarInvitado(nombre) {
  try {
    await signInAnonymously(auth);
  } catch (err) {
    alert(mensajeError(err));
    return;
  }
  nombreInvitado = nombre;
  uidInvitado = auth.currentUser.uid;
  sessionStorage.setItem("nombreInvitado", nombre);

  $("subtitulo").textContent = "Hola " + nombre + ". Marca todos los regalos que vas a comprar y pulsa «Guardar mis regalos».";
  mostrar(["lista-caja"]);
  $("btn-guardar-compras").hidden = false;
  escucharRegalos(listaId);
}

$("form-invitado").addEventListener("submit", function (e) {
  e.preventDefault();
  entrarInvitado($("inv-nombre").value.trim());
});

$("btn-incognito").addEventListener("click", function () {
  entrarInvitado("Anónimo");
});

$("btn-guardar-compras").addEventListener("click", async function () {
  const lote = writeBatch(db);
  let cambios = 0;

  regalos.forEach(function (r) {
    const esMio = r.compradoUid === uidInvitado;
    if (r.compradoUid && !esMio) return; // lo compró otra persona
    const referencia = doc(db, "listas", listaId, "regalos", r.id);
    if (seleccion.has(r.id) && !esMio) {
      lote.update(referencia, { compradoUid: uidInvitado, compradoPor: nombreInvitado });
      cambios++;
    } else if (!seleccion.has(r.id) && esMio) {
      lote.update(referencia, { compradoUid: "", compradoPor: "" });
      cambios++;
    }
  });

  if (cambios === 0) {
    alert("No hay cambios para guardar.");
    return;
  }

  try {
    await lote.commit();
    alert("¡Guardado!");
  } catch (err) {
    alert("No se pudo guardar. Puede que otra persona haya marcado uno de esos regalos justo antes. Revisa la lista e inténtalo de nuevo.\n(" + mensajeError(err) + ")");
  }
});

// ---------- Inicio ----------
if (esInvitado) {
  iniciarInvitado();
} else {
  onAuthStateChanged(auth, function (usuario) {
    if (ocupado) return;
    if (usuario && !usuario.isAnonymous) abrirPanel(usuario);
    else irALogin();
  });
}
