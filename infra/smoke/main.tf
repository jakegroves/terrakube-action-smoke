terraform {
  required_version = ">= 1.9.0"
}

resource "terraform_data" "smoke" {
  input = var.smoke_message
}

output "smoke" {
  value = terraform_data.smoke.output
}
