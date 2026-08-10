Feature: Login
  As a registered user
  I want to log in to the application

  Scenario: Successful login with valid credentials
    Given a registered user on the login page
    When they submit valid credentials
    Then they see the dashboard
