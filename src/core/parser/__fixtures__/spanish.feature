# language: es
Característica: Inicio de sesión
  Como usuario registrado
  Quiero iniciar sesión en la aplicación

  Escenario: Inicio de sesión exitoso con credenciales válidas
    Dado un usuario registrado en la página de inicio de sesión
    Cuando envía credenciales válidas
    Entonces ve el panel principal
