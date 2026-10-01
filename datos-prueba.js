// Crea 3 cumpleañeros de prueba con 10 regalos cada uno en Firebase.
// Para quitarlo, borra este archivo, su import en app.js y el botón de index.html.
import { createUserWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, setDoc, addDoc, collection } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const cuentas = [
  { usuario: "ana", nombre: "Ana", fecha: "1995-03-14", clave: "ana123",
    regalos: ["Audífonos inalámbricos", "Libro de cocina", "Mochila de viaje", "Termo de acero", "Lámpara de escritorio",
              "Set de maquillaje", "Zapatillas deportivas", "Reloj inteligente", "Cafetera pequeña", "Cámara instantánea"] },
  { usuario: "carlos", nombre: "Carlos", fecha: "1990-07-22", clave: "carlos123",
    regalos: ["Teclado mecánico", "Balón de fútbol", "Camiseta de equipo", "Mouse gamer", "Parlante bluetooth",
              "Cartera de cuero", "Perfume", "Juego de mesa", "Bicicleta plegable", "Cinturón"] },
  { usuario: "lucia", nombre: "Lucía", fecha: "2000-11-05", clave: "lucia123",
    regalos: ["Kindle", "Set de acuarelas", "Planta decorativa", "Bufanda de lana", "Tabla de yoga",
              "Aretes de plata", "Rompecabezas 1000 piezas", "Cuaderno de dibujo", "Vela aromática", "Tetera de vidrio"] }
];

export async function crearDatosPrueba(auth, db) {
  const resumen = [];

  for (const c of cuentas) {
    let credencial;
    try {
      credencial = await createUserWithEmailAndPassword(auth, c.usuario + "@regalos.app", c.clave);
    } catch (e) {
      if (e.code === "auth/email-already-in-use") {
        resumen.push(c.usuario + " (ya existía)");
        continue;
      }
      throw e;
    }

    const uid = credencial.user.uid;
    await setDoc(doc(db, "listas", uid), { usuario: c.usuario, nombre: c.nombre, fecha: c.fecha });

    for (let i = 0; i < c.regalos.length; i++) {
      await addDoc(collection(db, "listas", uid, "regalos"), {
        titulo: c.regalos[i],
        enlace: "https://www.amazon.com/s?k=" + encodeURIComponent(c.regalos[i]),
        imagen: "https://picsum.photos/seed/" + c.usuario + i + "/140",
        compradoUid: "",
        compradoPor: "",
        creado: Date.now() + i
      });
    }
    resumen.push(c.usuario + " (creado)");
  }

  await signOut(auth);
  return resumen;
}
