# language: es
Característica: Carrito de compras
  Como cliente de la tienda online
  quiero administrar los productos en mi carrito
  para completar mi compra correctamente.

  Antecedentes:
    Dado que el cliente tiene una sesión iniciada
    Y el catálogo tiene productos con stock disponible

  @smoke
  Escenario: Agregar un producto al carrito
    Dado que el cliente está viendo el detalle de un producto
    Cuando presiona el botón "Agregar al carrito"
    Entonces el producto aparece en el carrito
    Y el contador de artículos del carrito se incrementa en 1

  @regression
  Escenario: Eliminar un producto del carrito
    Dado que el cliente tiene al menos un producto en el carrito
    Cuando elimina ese producto del carrito
    Entonces el carrito queda vacío
    Y el contador de artículos del carrito muestra 0

  @regression
  Esquema del escenario: Aplicar un cupón de descuento válido e inválido
    Dado que el cliente tiene productos en el carrito por un total de "<total>"
    Cuando aplica el cupón "<cupon>"
    Entonces el sistema muestra "<resultado>"

    Ejemplos:
      | total  | cupon       | resultado                        |
      | 100.00 | DESCUENTO10 | Descuento del 10% aplicado       |
      | 50.00  | INVALIDO    | El cupón ingresado no es válido  |
