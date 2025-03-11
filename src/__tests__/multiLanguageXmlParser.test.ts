import { parseXmlString } from '../main/xmlUtils';

describe('Multi-Language XML Parser Support', () => {
  test('should parse Swift code with string interpolation', async () => {
    const swiftXml = 
`<changed_files>
  <file>
    <file_summary>Swift code with string interpolation</file_summary>
    <file_operation>CREATE</file_operation>
    <file_path>src/swift/MyView.swift</file_path>
    <file_code><![CDATA[
import SwiftUI

struct ContentView: View {
    @State private var name = "World"
    
    var body: some View {
        VStack {
            Text("Hello, \\(name)!")
                .font(.title)
                .padding()
            
            Button("Change Name") {
                if name == "World" {
                    name = "SwiftUI"
                } else {
                    name = "World"
                }
            }
            .padding()
            .background(Color.blue)
            .foregroundColor(.white)
            .cornerRadius(10)
        }
    }
}

struct ContentView_Previews: PreviewProvider {
    static var previews: some View {
        ContentView()
    }
}
    ]]></file_code>
  </file>
</changed_files>`;

    const changes = await parseXmlString(swiftXml);
    expect(changes).toHaveLength(1);
    expect(changes[0].file_path).toBe('src/swift/MyView.swift');
    expect(changes[0].file_code).toContain('Text("Hello, \\(name)!")');
  });

  test('should parse Ruby code with string interpolation', async () => {
    const rubyXml = `
<changed_files>
  <file>
    <file_summary>Ruby code with string interpolation</file_summary>
    <file_operation>CREATE</file_operation>
    <file_path>src/ruby/user.rb</file_path>
    <file_code><![CDATA[
class User
  attr_accessor :name, :email
  
  def initialize(name, email)
    @name = name
    @email = email
  end
  
  def greeting
    "Hello, #{@name}! Your email is #{@email}"
  end
  
  def to_s
    "User: #{@name} <#{@email}>"
  end
end

# Create a new user
user = User.new("John Doe", "john@example.com")
puts user.greeting
puts user
    ]]></file_code>
  </file>
</changed_files>
`;

    const changes = await parseXmlString(rubyXml);
    expect(changes).toHaveLength(1);
    expect(changes[0].file_path).toBe('src/ruby/user.rb');
    expect(changes[0].file_code).toContain('Hello, #{@name}!');
  });

  test('should parse Python code with f-strings', async () => {
    const pythonXml = `
<changed_files>
  <file>
    <file_summary>Python code with f-strings</file_summary>
    <file_operation>CREATE</file_operation>
    <file_path>src/python/app.py</file_path>
    <file_code><![CDATA[
class User:
    def __init__(self, name, email):
        self.name = name
        self.email = email
    
    def greeting(self):
        return f"Hello, {self.name}! Your email is {self.email}"
    
    def __str__(self):
        return f"User: {self.name} <{self.email}>"

# Create a new user
user = User("John Doe", "john@example.com")
print(user.greeting())
print(user)

# Multi-line f-string
message = f"""
Dear {user.name},

Thank you for signing up!
Your account details:
- Email: {user.email}
- Created: {import datetime; datetime.datetime.now().strftime('%Y-%m-%d')}

Best regards,
The Team
"""
print(message)
    ]]></file_code>
  </file>
</changed_files>
`;

    const changes = await parseXmlString(pythonXml);
    expect(changes).toHaveLength(1);
    expect(changes[0].file_path).toBe('src/python/app.py');
    expect(changes[0].file_code).toContain('f"Hello, {self.name}!');
  });

  test('should parse Go code with complex syntax', async () => {
    // Define the Go code with raw string literal separately with proper escaping
    const goRawStringContent = 
`Dear %s,

Thank you for signing up!
Your account details:
- Email: %s
- Created: %s

Best regards,
The Team`;

    const goXml = `
<changed_files>
  <file>
    <file_summary>Go code with complex syntax</file_summary>
    <file_operation>CREATE</file_operation>
    <file_path>src/go/main.go</file_path>
    <file_code><![CDATA[
package main

import (
	"fmt"
	"strings"
	"time"
)

type User struct {
	Name  string
	Email string
}

func (u User) Greeting() string {
	return fmt.Sprintf("Hello, %s! Your email is %s", u.Name, u.Email)
}

func (u User) String() string {
	return fmt.Sprintf("User: %s <%s>", u.Name, u.Email)
}

func main() {
	// Create a new user
	user := User{
		Name:  "John Doe",
		Email: "john@example.com",
	}
	
	fmt.Println(user.Greeting())
	fmt.Println(user)
	
	// Using raw string literals with fmt.Sprintf
	message := fmt.Sprintf(\`${goRawStringContent}\`, user.Name, user.Email, time.Now().Format("2006-01-02"))
	fmt.Println(message)
	
	// Using string builder
	var sb strings.Builder
	sb.WriteString("User information:\\n")
	sb.WriteString(fmt.Sprintf("- Name: %s\\n", user.Name))
	sb.WriteString(fmt.Sprintf("- Email: %s\\n", user.Email))
	fmt.Println(sb.String())
}
    ]]></file_code>
  </file>
</changed_files>
`;

    const changes = await parseXmlString(goXml);
    expect(changes).toHaveLength(1);
    expect(changes[0].file_path).toBe('src/go/main.go');
    expect(changes[0].file_code).toContain('fmt.Sprintf("Hello, %s!');
  });

  test('should parse Rust code with complex syntax', async () => {
    const rustXml = `
<changed_files>
  <file>
    <file_summary>Rust code with complex syntax</file_summary>
    <file_operation>CREATE</file_operation>
    <file_path>src/rust/main.rs</file_path>
    <file_code><![CDATA[
use std::fmt;
use chrono::Local;

struct User {
    name: String,
    email: String,
}

impl User {
    fn new(name: &str, email: &str) -> Self {
        User {
            name: name.to_string(),
            email: email.to_string(),
        }
    }
    
    fn greeting(&self) -> String {
        format!("Hello, {}! Your email is {}", self.name, self.email)
    }
}

impl fmt::Display for User {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "User: {} <{}>", self.name, self.email)
    }
}

fn main() {
    // Create a new user
    let user = User::new("John Doe", "john@example.com");
    
    println!("{}", user.greeting());
    println!("{}", user);
    
    // Using raw string literals
    let message = format!(r#"
Dear {},

Thank you for signing up!
Your account details:
- Email: {}
- Created: {}

Best regards,
The Team
"#, user.name, user.email, Local::now().format("%Y-%m-%d"));
    
    println!("{}", message);
    
    // Using string concatenation with format!
    let info = format!(
        "User information:\n- Name: {}\n- Email: {}", 
        user.name, 
        user.email
    );
    println!("{}", info);
}
    ]]></file_code>
  </file>
</changed_files>
`;

    const changes = await parseXmlString(rustXml);
    expect(changes).toHaveLength(1);
    expect(changes[0].file_path).toBe('src/rust/main.rs');
    expect(changes[0].file_code).toContain('format!("Hello, {}!');
  });

  test('should parse PHP code with string interpolation', async () => {
    const phpXml = `
<changed_files>
  <file>
    <file_summary>PHP code with string interpolation</file_summary>
    <file_operation>CREATE</file_operation>
    <file_path>src/php/User.php</file_path>
    <file_code><![CDATA[
<?php

class User {
    private $name;
    private $email;
    
    public function __construct($name, $email) {
        $this->name = $name;
        $this->email = $email;
    }
    
    public function greeting() {
        return "Hello, {$this->name}! Your email is {$this->email}";
    }
    
    public function __toString() {
        return "User: {$this->name} <{$this->email}>";
    }
}

// Create a new user
$user = new User("John Doe", "john@example.com");
echo $user->greeting() . PHP_EOL;
echo $user . PHP_EOL;

// Heredoc syntax
$message = <<<EOT
Dear {$user->name},

Thank you for signing up!
Your account details:
- Email: {$user->email}
- Created: {date('Y-m-d')}

Best regards,
The Team
EOT;

echo $message . PHP_EOL;
    ]]></file_code>
  </file>
</changed_files>
`;

    const changes = await parseXmlString(phpXml);
    expect(changes).toHaveLength(1);
    expect(changes[0].file_path).toBe('src/php/User.php');
    expect(changes[0].file_code).toContain('Hello, {$this->name}!');
  });

  test('should parse C# code with string interpolation', async () => {
    const csharpXml = `
<changed_files>
  <file>
    <file_summary>C# code with string interpolation</file_summary>
    <file_operation>CREATE</file_operation>
    <file_path>src/csharp/User.cs</file_path>
    <file_code><![CDATA[
using System;

namespace UserManagement
{
    public class User
    {
        public string Name { get; set; }
        public string Email { get; set; }
        
        public User(string name, string email)
        {
            Name = name;
            Email = email;
        }
        
        public string Greeting()
        {
            return $"Hello, {Name}! Your email is {Email}";
        }
        
        public override string ToString()
        {
            return $"User: {Name} <{Email}>";
        }
    }
    
    class Program
    {
        static void Main(string[] args)
        {
            // Create a new user
            var user = new User("John Doe", "john@example.com");
            Console.WriteLine(user.Greeting());
            Console.WriteLine(user);
            
            // Multi-line string interpolation
            var message = $@"
Dear {user.Name},

Thank you for signing up!
Your account details:
- Email: {user.Email}
- Created: {DateTime.Now:yyyy-MM-dd}

Best regards,
The Team
";
            Console.WriteLine(message);
        }
    }
}
    ]]></file_code>
  </file>
</changed_files>
`;

    const changes = await parseXmlString(csharpXml);
    expect(changes).toHaveLength(1);
    expect(changes[0].file_path).toBe('src/csharp/User.cs');
    expect(changes[0].file_code).toContain('$"Hello, {Name}!');
  });

  test('should parse multiple files with different languages', async () => {
    const multiLanguageXml = `
<changed_files>
  <file>
    <file_summary>Python file</file_summary>
    <file_operation>CREATE</file_operation>
    <file_path>src/python/hello.py</file_path>
    <file_code><![CDATA[
def greet(name):
    return f"Hello, {name}!"

print(greet("World"))
    ]]></file_code>
  </file>
  <file>
    <file_summary>Ruby file</file_summary>
    <file_operation>CREATE</file_operation>
    <file_path>src/ruby/hello.rb</file_path>
    <file_code><![CDATA[
def greet(name)
  "Hello, #{name}!"
end

puts greet("World")
    ]]></file_code>
  </file>
  <file>
    <file_summary>Go file</file_summary>
    <file_operation>CREATE</file_operation>
    <file_path>src/go/hello.go</file_path>
    <file_code><![CDATA[
package main

import "fmt"

func greet(name string) string {
    return fmt.Sprintf("Hello, %s!", name)
}

func main() {
    fmt.Println(greet("World"))
}
    ]]></file_code>
  </file>
</changed_files>
`;

    const changes = await parseXmlString(multiLanguageXml);
    expect(changes).toHaveLength(3);
    expect(changes[0].file_path).toBe('src/python/hello.py');
    expect(changes[1].file_path).toBe('src/ruby/hello.rb');
    expect(changes[2].file_path).toBe('src/go/hello.go');
  });
});
