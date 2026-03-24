import sys
import importlib

def check_package(package_name):
    try:
        module = importlib.import_module(package_name)
        print(f"✅ {package_name} is installed (version: {getattr(module, '__version__', 'unknown')})")
        return True
    except ImportError:
        print(f"❌ {package_name} is NOT installed")
        return False

def main():
    print(f"Python Version: {sys.version}")
    print(f"Python Executable: {sys.executable}\n")
    
    packages = ["fastapi", "uvicorn", "numpy", "pydantic", "starlette"]
    all_ok = True
    for pkg in packages:
        if not check_package(pkg):
            all_ok = False
            
    if all_ok:
        print("\n🎉 All core dependencies are found! If you still see red lines in your IDE, please ensure you have selected the correct Python interpreter in your editor.")
    else:
        print("\n⚠️ Some dependencies are missing. Run: pip install -r requirements.txt")

if __name__ == "__main__":
    main()
