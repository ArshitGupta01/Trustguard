import sys
import importlib

def check_package(package_name):
    try:
        module = importlib.import_module(package_name)
        print(f"[OK] {package_name} is installed (version: {getattr(module, '__version__', 'unknown')})")
        return True
    except ImportError:
        print(f"[MISSING] {package_name} is NOT installed")
        return False

def main():
    print(f"Python Version: {sys.version}")
    print(f"Python Executable: {sys.executable}\n")
    
    packages = [
        "fastapi", "uvicorn", "numpy", "pydantic", "starlette", 
        "pymongo", "motor", "scikit-learn", "requests", "python-dotenv"
    ]
    all_ok = True
    for pkg in packages:
        # Some packages have different import names
        import_name = pkg
        if pkg == "scikit-learn": import_name = "sklearn"
        elif pkg == "python-dotenv": import_name = "dotenv"
        
        if not check_package(import_name):
            all_ok = False
            
    if all_ok:
        print("\n🎉 All core dependencies are found!")
        print("\nIf you still see red lines in your IDE (Antigravity/VS Code):")
        print("1. Press Ctrl+Shift+P")
        print("2. Type 'Python: Select Interpreter'")
        print(f"3. Select the one in: ./venv/Scripts/python.exe")
    else:
        print("\n⚠️ Some dependencies are missing. Run: pip install -r requirements.txt")

if __name__ == "__main__":
    main()
