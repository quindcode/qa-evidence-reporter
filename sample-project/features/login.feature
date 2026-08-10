# language: es
Característica: Inicio de sesión
  Como usuaria registrada de la tienda online
  quiero iniciar sesión con mis credenciales
  para acceder a mi cuenta y a mi historial de pedidos.

  @smoke
  Escenario: Inicio de sesión exitoso con credenciales válidas
    Dado que un usuario registrado está en la página de inicio de sesión
    Cuando ingresa su usuario y contraseña válidos
    Y presiona el botón "Ingresar"
    Entonces accede correctamente a su cuenta
    Y ve su nombre en la cabecera del sitio

  @regression
  Escenario: Inicio de sesión fallido con contraseña incorrecta
    Dado que un usuario registrado está en la página de inicio de sesión
    Cuando ingresa un usuario válido con una contraseña incorrecta
    Entonces ve un mensaje de error indicando credenciales inválidas
    Y permanece en la página de inicio de sesión

  @regression
  Escenario: Bloqueo de cuenta tras varios intentos fallidos
    Dado que un usuario registrado está en la página de inicio de sesión
    Cuando ingresa una contraseña incorrecta 5 veces consecutivas
    Entonces la cuenta queda bloqueada temporalmente
    Y ve un mensaje explicando cómo desbloquearla
